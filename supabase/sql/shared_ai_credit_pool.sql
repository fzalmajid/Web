-- Shared daily pool, preserving counters, authentication, privileges and pool locking.
-- limit/fair_share retain the full pool size for legacy clients; used stays personal.
CREATE OR REPLACE FUNCTION public.consume_ai_credits(action_name text, ai_mode text DEFAULT 'instant'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Jakarta')::date;
  v_pool_total integer := 400;
  v_mode text := lower(coalesce(ai_mode,'instant'));
  v_cost integer;
  v_ask integer:=0; v_study integer:=0; v_transcription integer:=0;
  v_file_light integer:=0; v_file_heavy integer:=0;
  v_user_used integer:=0; v_user_shared_requests integer:=0;
  v_total_used integer:=0; v_active_accounts integer:=0;
  v_prospective_active integer:=1; v_fair_share integer:=0;
  v_user_remaining integer:=0; v_pool_remaining integer:=0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  if v_mode not in ('instant','medium','high') then v_mode:='instant'; end if;

  case action_name
    when 'ask' then
      v_cost:=case v_mode when 'instant' then 1 when 'medium' then 2 else 4 end;
      v_ask:=1;
    when 'ask_web' then
      v_cost:=case v_mode when 'instant' then 3 when 'medium' then 5 else 8 end;
      v_ask:=1;
    when 'study' then
      v_cost:=case v_mode when 'instant' then 2 when 'medium' then 4 else 6 end;
      v_study:=1;
    when 'grade_essay' then
      -- Essay grading is a lighter request. Cost ~= study / 1.7, rounded to integer credits.
      v_cost:=case v_mode when 'instant' then 1 when 'medium' then 2 else 3 end;
      v_study:=1;
    when 'transcription' then
      v_cost:=case v_mode when 'instant' then 5 when 'medium' then 7 else 10 end;
      v_transcription:=1;
    when 'file_light' then
      v_cost:=case v_mode when 'instant' then 2 when 'medium' then 3 else 5 end;
      v_file_light:=1;
    when 'file_heavy' then
      v_cost:=case v_mode when 'instant' then 5 when 'medium' then 7 else 10 end;
      v_file_heavy:=1;
    else
      raise exception 'Invalid AI action';
  end case;

  perform pg_advisory_xact_lock(hashtext('ruang-belajar-ai-pool:'||v_day::text));

  select s.active_accounts,s.total_used into v_active_accounts,v_total_used
  from private.ai_pool_state(v_day) s;

  select coalesce(credits_used,0),coalesce(shared_request_count,0)
    into v_user_used,v_user_shared_requests
  from private.ai_daily_usage
  where user_id=v_uid and usage_date=v_day;

  if not found then v_user_used:=0; v_user_shared_requests:=0; end if;

  v_prospective_active :=
    greatest(1, v_active_accounts + case when v_user_shared_requests>0 then 0 else 1 end);
  v_fair_share := v_pool_total;
  v_user_remaining := greatest(v_fair_share-v_user_used,0);
  v_pool_remaining := greatest(v_pool_total-v_total_used,0);

  if v_cost>v_pool_remaining then
    return jsonb_build_object(
      'allowed',false,'mode',v_mode,'cost',v_cost,'used',v_user_used,
      'limit',v_fair_share,'remaining',v_pool_remaining,
      'fair_share',v_fair_share,'active_accounts',v_prospective_active,
      'quota_policy','shared_pool', 'pool_total',v_pool_total,'pool_used',v_total_used,
      'pool_remaining',v_pool_remaining,'reset_timezone','Asia/Jakarta'
    );
  end if;

  insert into private.ai_daily_usage as u (
    user_id,usage_date,credits_used,ask_count,study_count,transcription_count,
    file_light_count,file_heavy_count,updated_at
  )
  values (
    v_uid,v_day,v_cost,v_ask,v_study,v_transcription,v_file_light,v_file_heavy,now()
  )
  on conflict (user_id,usage_date)
  do update set
    credits_used=u.credits_used+excluded.credits_used,
    ask_count=u.ask_count+excluded.ask_count,
    study_count=u.study_count+excluded.study_count,
    transcription_count=u.transcription_count+excluded.transcription_count,
    file_light_count=u.file_light_count+excluded.file_light_count,
    file_heavy_count=u.file_heavy_count+excluded.file_heavy_count,
    updated_at=now();

  v_user_used:=v_user_used+v_cost;
  select s.active_accounts,s.total_used into v_active_accounts,v_total_used
  from private.ai_pool_state(v_day) s;
  v_fair_share:=v_pool_total;
  v_user_remaining:=greatest(v_fair_share-v_user_used,0);
  v_pool_remaining:=greatest(v_pool_total-v_total_used,0);

  return jsonb_build_object(
    'allowed',true,'mode',v_mode,'cost',v_cost,'used',v_user_used,
    'limit',v_fair_share,'remaining',v_pool_remaining,
    'fair_share',v_fair_share,'active_accounts',greatest(v_active_accounts,1),
    'quota_policy','shared_pool', 'pool_total',v_pool_total,'pool_used',v_total_used,
    'pool_remaining',v_pool_remaining,'reset_timezone','Asia/Jakarta'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_ai_usage_today()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'private', 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_day date := (now() at time zone 'Asia/Jakarta')::date;
  v_pool_total integer := 400;
  v_user_used integer := 0;
  v_active_accounts integer := 0;
  v_total_used integer := 0;
  v_effective_active integer := 1;
  v_fair_share integer := 400;

  v_ask integer := 0;
  v_study integer := 0;
  v_transcription integer := 0;
  v_file_light integer := 0;
  v_file_heavy integer := 0;

  v_input_tokens bigint := 0;
  v_output_tokens bigint := 0;
  v_thoughts_tokens bigint := 0;
  v_total_tokens bigint := 0;
  v_gemini_requests integer := 0;
  v_shared_requests integer := 0;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;

  select s.active_accounts, s.total_used
    into v_active_accounts, v_total_used
  from private.ai_pool_state(v_day) s;

  select
    coalesce(credits_used,0),
    coalesce(ask_count,0),
    coalesce(study_count,0),
    coalesce(transcription_count,0),
    coalesce(file_light_count,0),
    coalesce(file_heavy_count,0),
    coalesce(input_tokens,0),
    coalesce(output_tokens,0),
    coalesce(thoughts_tokens,0),
    coalesce(total_tokens,0),
    coalesce(gemini_request_count,0),
    coalesce(shared_request_count,0)
  into
    v_user_used,
    v_ask,
    v_study,
    v_transcription,
    v_file_light,
    v_file_heavy,
    v_input_tokens,
    v_output_tokens,
    v_thoughts_tokens,
    v_total_tokens,
    v_gemini_requests,
    v_shared_requests
  from private.ai_daily_usage
  where user_id=v_uid and usage_date=v_day;

  if not found then
    v_user_used:=0; v_ask:=0; v_study:=0; v_transcription:=0;
    v_file_light:=0; v_file_heavy:=0; v_input_tokens:=0; v_output_tokens:=0;
    v_thoughts_tokens:=0; v_total_tokens:=0; v_gemini_requests:=0; v_shared_requests:=0;
  end if;

  -- One shared application pool; active accounts are informational only.
  v_effective_active :=
    greatest(1, v_active_accounts + case when v_shared_requests > 0 then 0 else 1 end);
  v_fair_share := v_pool_total;

  return jsonb_build_object(
    'used', v_user_used,
    'limit', v_fair_share,
    'remaining', greatest(v_pool_total-v_total_used,0),
    'fair_share', v_fair_share,
    'active_accounts', v_effective_active,
    'actual_active_accounts', v_active_accounts,
    'quota_policy','shared_pool', 'pool_total', v_pool_total,
    'pool_used', v_total_used,
    'pool_remaining', greatest(v_pool_total-v_total_used,0),
    'ask_count', v_ask,
    'study_count', v_study,
    'transcription_count', v_transcription,
    'file_light_count', v_file_light,
    'file_heavy_count', v_file_heavy,
    'input_tokens', v_input_tokens,
    'output_tokens', v_output_tokens,
    'thoughts_tokens', v_thoughts_tokens,
    'total_tokens', v_total_tokens,
    'gemini_request_count', v_gemini_requests,
    'shared_request_count', v_shared_requests,
    'reset_timezone', 'Asia/Jakarta'
  );
end;
$function$;
