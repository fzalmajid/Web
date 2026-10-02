import { load, type CheerioAPI } from "cheerio";

const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const doiValue = (value: string) => value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();

/** Inert server-side parsing: never execute page scripts or resolve XML external entities. */
export function readableMarkup(markup: string, xml = false, selector?: string, limit = 16000) {
  if (xml && /<!ENTITY|<!DOCTYPE[^>]*\[/i.test(markup)) return "";
  const $ = load(markup, xml ? { xml: true } : undefined);
  const root = selector ? $(selector).first() : $.root();
  root.find("script,style,noscript,nav,footer,header,form,button,iframe,svg,ref-list").remove();
  root.find("table").each((_, table) => {
    const lines: string[] = [];
    $(table).find("tr").each((_, row) => {
      lines.push($(row).children("th,td").map((_, cell) => compact($(cell).text())).get().join(" | "));
    });
    $(table).replaceWith("\n[TABLE]\n" + lines.join("\n") + "\n[/TABLE]\n");
  });
  root.find("br").replaceWith("\n");
  root.find("p,div,section,article,sec,li,h1,h2,h3,h4,title,caption,table-wrap,abstract").each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  return root.text().split("\n").map(compact).filter(Boolean).join("\n").slice(0, limit);
}

export type ArticleText = { title: string; doi: string; text: string; fullText: boolean; metadataHtml?: string };
function meta($: CheerioAPI, name: string) {
  return $("meta").filter((_, el) => ($(el).attr("name") || $(el).attr("property"))?.toLowerCase() === name).first().attr("content") || "";
}

export function parseHtmlArticle(html: string): ArticleText {
  const $ = load(html);
  const title = compact(meta($, "citation_title") || meta($, "dc.title") || $("h1").first().text());
  const doi = doiValue(meta($, "citation_doi") || meta($, "dc.identifier"));
  const root = $(".article-body,.article__body,.article-content,#article-body,#main-content article,main article,article,main").filter((_, el) => {
    const headings = $(el).find("h2,h3,h4").map((_, h) => compact($(h).text())).get();
    const sections = headings.filter(h => /introduction|methods|materials|results|discussion|conclusion|pendahuluan|metode|hasil|pembahasan|kesimpulan/i.test(h));
    return sections.length >= 2 && $(el).text().length >= 1200;
  }).first();
  root.find(".references,#references,[role='doc-bibliography'],.ref-list").remove();
  const text = root.length ? readableMarkup($.html(root), false) : "";
  return { title, doi, text, fullText: text.length >= 1000 };
}

export function parseJatsArticle(xml: string): ArticleText {
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(xml)) return { title: "", doi: "", text: "", fullText: false };
  const $ = load(xml, { xml: true });
  const front = $("article > front").first();
  const title = compact(front.find("article-title").first().text());
  const doi = doiValue(front.find('article-id[pub-id-type="doi"]').first().text());
  const body = $("article > body").first();
  const text = readableMarkup($.xml(body), true);
  const fullText = body.find("sec").length >= 1 && text.length >= 800;
  // Supply only this article's front matter to the existing metadata reconciler.
  const metadata: Array<[string, string]> = [["citation_title", title], ["citation_doi", doi], ["citation_journal_title", compact(front.find("journal-title").first().text())], ["citation_volume", front.find("volume").first().text()], ["citation_issue", front.find("issue").first().text()], ["citation_firstpage", front.find("fpage").first().text()], ["citation_lastpage", front.find("lpage").first().text()]];
  const pubDate = front.find('pub-date[pub-type="epub"],pub-date[publication-format="electronic"],pub-date[pub-type="ppub"],pub-date[publication-format="print"]' ).first();
  metadata.push(["citation_publication_date", pubDate.find("year").text()]);
  front.find('contrib[contrib-type="author"] name').each((_, name) => {metadata.push(["citation_author", compact($(name).find("given-names").text() + " " + $(name).find("surname").text())]);});
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return { title, doi, text, fullText, metadataHtml: metadata.filter(([, value]) => value).map(([name, value]) => `<meta name="${name}" content="${escape(value)}">`).join("") };
}

export function pageTitle(html: string) {
  const $ = load(html);
  return compact(meta($, "og:title") || $("h1").first().text() || $("title").text()).slice(0, 1000);
}
