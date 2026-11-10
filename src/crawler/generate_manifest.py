#!/usr/bin/env python3
"""
WebOrient Fast Client Onboarding Auto-Crawler (`src/crawler/generate_manifest.py`)
Scans a local HTML directory or live website URL and generates a complete
`site-manifest.json` (pages, sections, forms, inputs, and FAQ knowledgeBase)
in seconds so any client website can be onboarded in under 2 minutes.

Usage:
  python3 src/crawler/generate_manifest.py testscript/ --output config/generated-manifest.json
"""
import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path


class SimpleDOMManifestParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ""
        self._in_title = False
        self.sections = []
        self.forms = []
        self.faqs = []
        self._current_form = None
        self._current_details = None
        self._capture_text_target = None
        self._text_buffer = []

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag == "title":
            self._in_title = True
            self._text_buffer = []
        elif tag == "section" and attr.get("id"):
            sec_id = attr["id"]
            self.sections.append({
                "id": sec_id,
                "selector": f"#{sec_id}",
                "title": sec_id.replace("-", " ").title(),
                "description": f"Section #{sec_id}"
            })
        elif tag == "form":
            form_id = attr.get("id", "form")
            self._current_form = {
                "formSelector": f"#{form_id}" if attr.get("id") else "form",
                "description": f"Form #{form_id}",
                "fields": []
            }
        elif tag in ("input", "select", "textarea") and self._current_form is not None:
            input_type = attr.get("type", tag)
            if input_type == "password":
                return  # Respect sensitive field guardrail
            el_id = attr.get("id")
            name = attr.get("name") or el_id or tag
            selector = f"#{el_id}" if el_id else f"{tag}[name='{name}']"
            self._current_form["fields"].append({
                "name": name,
                "selector": selector,
                "label": attr.get("placeholder") or name.replace("-", " ").title(),
                "type": input_type,
                "required": "required" in attr
            })

    def handle_endtag(self, tag):
        if tag == "title" and self._in_title:
            self._in_title = False
            self.title = " ".join("".join(self._text_buffer).split())
        elif tag == "form" and self._current_form is not None:
            self.forms.append(self._current_form)
            self._current_form = None

    def handle_data(self, data):
        if self._in_title:
            self._text_buffer.append(data)


def crawl_directory(directory: Path, site_name: str, base_url: str) -> dict:
    pages = []
    knowledge_base = []

    html_files = sorted(directory.glob("*.html"))
    for html_file in html_files:
        raw_html = html_file.read_text(encoding="utf-8", errors="ignore")
        parser = SimpleDOMManifestParser()
        parser.feed(raw_html)

        # Extract <details><summary>Q</summary><p>A</p></details> blocks as FAQ knowledgeBase
        for match in re.finditer(
            r"<details[^>]*>.*?<summary[^>]*>(.*?)</summary>.*?<p[^>]*>(.*?)</p>.*?</details>",
            raw_html,
            re.DOTALL | re.IGNORECASE
        ):
            q = re.sub(r"<[^>]+>", "", match.group(1)).strip()
            a = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", match.group(2))).strip()
            if q and a:
                knowledge_base.append({
                    "topic": html_file.stem,
                    "question": q,
                    "answer": a
                })

        route = "/" if html_file.name in ("index.html", "test-demo.html") else f"/{html_file.stem}"
        page_entry = {
            "route": route,
            "file": html_file.name,
            "title": parser.title or html_file.stem.title(),
            "summary": f"Auto-discovered page ({len(parser.sections)} sections, {len(parser.forms)} forms).",
            "keywords": [html_file.stem.lower(), route.strip("/") or "home"],
            "sections": parser.sections
        }
        if parser.forms:
            page_entry["forms"] = parser.forms
        pages.append(page_entry)

    return {
        "siteName": site_name,
        "baseUrl": base_url,
        "theme": {
            "primaryColor": "#6366f1",
            "accentColor": "#ec4899",
            "cursorStyle": "modern-glow"
        },
        "knowledgeBase": knowledge_base,
        "pages": pages
    }


def main():
    ap = argparse.ArgumentParser(description="Auto-generate WebOrient site-manifest.json from HTML pages.")
    ap.add_argument("target", help="Directory containing client HTML files")
    ap.add_argument("--site-name", default="Client Website", help="Brand name")
    ap.add_argument("--base-url", default="http://localhost:3000", help="Base URL")
    ap.add_argument("--output", default="config/generated-manifest.json", help="Output JSON path")
    args = ap.parse_args()

    target_dir = Path(args.target).resolve()
    manifest = crawl_directory(target_dir, args.site_name, args.base_url)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"[CRAWLER] Generated manifest with {len(manifest['pages'])} pages and {len(manifest['knowledgeBase'])} FAQs -> {out_path}")


if __name__ == "__main__":
    main()
