"use client";
import type { ReactNode } from "react";
import { safeAnswerLink, type AnswerProseBlock } from "@/lib/answerProse";

export default function AnswerProse({ blocks, anchors, renderText }: {
  blocks: AnswerProseBlock[]; anchors: Map<string, string>; renderText: (text: string) => ReactNode;
}) {
  function inline(text: string) {
    const result: ReactNode[] = [], pattern = /(`[^`\n]+`)|\[([^\]\n]+)\]\(([^\s)]+)\)|(https?:\/\/[^\s<>]+)/g;
    let last = 0, match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match.index > last) result.push(<span key={"t" + last}>{renderText(text.slice(last, match.index))}</span>);
      if (match[1]) result.push(<code key={match.index}>{match[1].slice(1, -1)}</code>);
      else {
        const token = match[4] || match[3];
        let uri = token.replace(/[.,;:!?]+$/, "");
        if (uri.endsWith(")") && (uri.match(/\)/g)?.length || 0) > (uri.match(/\(/g)?.length || 0)) uri = uri.slice(0, -1);
        const href = safeAnswerLink(uri, anchors), label = match[2] || uri;
        result.push(href ? <a key={match.index} href={href} {...(href.startsWith("#") ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{match[2] ? renderText(label) : label}</a> : <span key={match.index}>{renderText(match[2] || uri)}</span>);
        if (uri.length < token.length) result.push(token.slice(uri.length));
      }
      last = pattern.lastIndex;
    }
    if (last < text.length) result.push(<span key={"t" + last}>{renderText(text.slice(last))}</span>);
    return result.length ? result : renderText(text);
  }
  return <div className="aiAnswerProse">{blocks.map((block, index) => {
    if (block.kind === "heading") { const Tag = ("h" + block.level) as "h2" | "h3" | "h4" | "h5" | "h6"; return <Tag id={block.id} key={index}>{inline(block.text)}</Tag>; }
    if (block.kind === "rule") return <hr key={index}/>;
    if (block.kind === "code") return <pre key={index}><code>{block.text}</code></pre>;
    if (block.kind === "list") { const items = block.items.map((item, i) => <li key={i}>{inline(item)}</li>); return block.ordered ? <ol start={block.start} key={index}>{items}</ol> : <ul key={index}>{items}</ul>; }
    return <p key={index}>{inline(block.text)}</p>;
  })}</div>;
}
