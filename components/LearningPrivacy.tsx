"use client";
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { clearLearningCache } from "@/lib/learningStore";
export default function LearningPrivacy(){useEffect(()=>{const {data}=supabase.auth.onAuthStateChange(event=>{if(event==="SIGNED_OUT"){void clearLearningCache().catch(()=>undefined);void import("@/lib/localQwen").then(local=>local.unloadLocalQwen()).catch(()=>undefined);}});return()=>data.subscription.unsubscribe();},[]);return null;}
