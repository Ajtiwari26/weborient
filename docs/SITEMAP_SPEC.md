# WebOrient Site Manifest Specification (Sitemap)

The **Site Manifest** (`site-manifest.json`) serves as WebOrient's semantic map of a website. It gives the voice agent structural context about the entire site without requiring massive DOM dumps on every turn.

---

## 1. Schema Definition

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "WebOrientSiteManifest",
  "type": "object",
  "required": ["siteName", "baseUrl", "pages"],
  "properties": {
    "siteName": {
      "type": "string",
      "description": "The brand or website name."
    },
    "baseUrl": {
      "type": "string",
      "format": "uri",
      "description": "Base production URL of the website."
    },
    "theme": {
      "type": "object",
      "properties": {
        "primaryColor": { "type": "string", "example": "#6366f1" },
        "accentColor": { "type": "string", "example": "#a855f7" },
        "cursorStyle": { "type": "string", "enum": ["default", "modern-glow", "minimal", "stealth"] }
      }
    },
    "pages": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["route", "title", "summary"],
        "properties": {
          "route": {
            "type": "string",
            "description": "Relative URL path, e.g. /pricing or /contact"
          },
          "title": {
            "type": "string",
            "description": "Human-readable page title"
          },
          "summary": {
            "type": "string",
            "description": "Concise summary of page purpose and content for the voice agent"
          },
          "keywords": {
            "type": "array",
            "items": { "type": "string" },
            "description": "Keywords or search topics that should trigger navigation to this page"
          },
          "sections": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string" },
                "selector": { "type": "string" },
                "title": { "type": "string" },
                "description": { "type": "string" }
              }
            }
          },
          "forms": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "formSelector": { "type": "string" },
                "description": { "type": "string" },
                "fields": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "name": { "type": "string" },
                      "selector": { "type": "string" },
                      "label": { "type": "string" },
                      "type": { "type": "string" },
                      "required": { "type": "boolean" }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

---

## 2. Ingestion into the Model Prompt

When the session connects, the gateway compiles this manifest into a compressed prompt block:

```markdown
### SITE NAVIGATION CAPABILITIES
You can navigate users across this website using the `navigate_route` tool.
Here is the sitemap:
- Home (`/`): Landing page, hero showcase, core benefits.
- Features (`/features`): Breakdown of real-time audio, ghost cursor, and form filling.
- Pricing (`/pricing`): Starter ($29/mo), Pro ($79/mo), and Custom Enterprise plans.
- Contact (`/contact`): Consultation and demo booking form with fields: name, email, company, message.

When the user expresses intent or asks about pricing, features, or contacting support, navigate them to the right route and highlight the key sections.
```
