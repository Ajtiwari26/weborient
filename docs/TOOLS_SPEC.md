# WebOrient Live API Tool Specification (v0.2.0)

These 9 tool declarations are registered in the `tools` array of the Gemini Multimodal Live API session (`weborient_relay.py` and `weborient.js`). They give the voice agent complete coverage over Q&A, visual explanation, guided tours, navigation, form filling, scrolling, swiping/swapping, and clicking.

---

## 1. Tool Declarations

```json
[
  {
    "name": "move_and_highlight",
    "description": "Smoothly glides the ghost cursor along a cubic Bézier curve to a DOM element, surrounds it with a scroll-locked glowing spotlight border, and displays an on-screen explanation badge.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "selector": {
          "type": "STRING",
          "description": "CSS selector, element ID, data-wo-id (e.g. '[data-wo-id=\"wo-5\"]'), or accessible text label of the element."
        },
        "explanation": {
          "type": "STRING",
          "description": "Concise visual callout badge text displayed next to the highlighted element."
        }
      },
      "required": ["selector"]
    }
  },
  {
    "name": "click_element",
    "description": "Glides the ghost cursor to a button, link, tab, toggle, or interactive control, plays a click ripple animation, and dispatches full pointer and mouse click events.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "selector": {
          "type": "STRING",
          "description": "CSS selector, data-wo-id, or accessible label of the clickable element."
        },
        "confirmed": {
          "type": "BOOLEAN",
          "description": "Set to true only when the user has verbally confirmed a final form submission or purchase action."
        }
      },
      "required": ["selector"]
    }
  },
  {
    "name": "fill_form_field",
    "description": "Fills or sets a form control (text, email, tel, number, textarea, select dropdown, checkbox, radio, or range slider) with typewriter animation, React/Vue native state setters, and validation checking.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "selector": {
          "type": "STRING",
          "description": "CSS selector, data-wo-id, or label of the form field."
        },
        "value": {
          "type": "STRING",
          "description": "Value to enter, option text/value to select, or 'true'/'false' for checkboxes."
        }
      },
      "required": ["selector", "value"]
    }
  },
  {
    "name": "fill_form_batch",
    "description": "Fills multiple form fields sequentially in a single coordinated operation and returns validation results for the entire form.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "fields": {
          "type": "ARRAY",
          "description": "Ordered list of { selector, value } pairs to fill.",
          "items": {
            "type": "OBJECT",
            "properties": {
              "selector": { "type": "STRING" },
              "value": { "type": "STRING" }
            },
            "required": ["selector", "value"]
          }
        }
      },
      "required": ["fields"]
    }
  },
  {
    "name": "scroll_page",
    "description": "Smoothly scrolls the viewport or a scrollable container up, down, to the top/bottom, or directly to a target element/section.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "direction": {
          "type": "STRING",
          "enum": ["up", "down", "top", "bottom"],
          "description": "Direction of scroll."
        },
        "targetSelector": {
          "type": "STRING",
          "description": "Optional CSS selector or section ID to scroll directly into the center of the viewport."
        },
        "amount": {
          "type": "STRING",
          "enum": ["half", "page", "small"],
          "description": "Relative scroll distance when scrolling up or down (default: 'page')."
        }
      }
    }
  },
  {
    "name": "swipe_or_swap",
    "description": "Swipes a carousel/slider (next, prev, left, right), switches active tabs in a tablist, toggles a switch (e.g., Monthly/Annual billing), or adjusts a range slider.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "selector": {
          "type": "STRING",
          "description": "CSS selector of the carousel, tab container, tab button, toggle switch, or slider."
        },
        "action": {
          "type": "STRING",
          "enum": ["next", "prev", "left", "right", "toggle", "select"],
          "description": "Gesture or swap action to perform."
        },
        "targetValue": {
          "type": "STRING",
          "description": "Optional target tab name, slide index (0-based), or slider value."
        }
      },
      "required": ["selector", "action"]
    }
  },
  {
    "name": "navigate_route",
    "description": "Navigates the user to an in-page section anchor, SPA route, or page URL while preserving session state.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "path": {
          "type": "STRING",
          "description": "Target route path, section hash (e.g. '#pricing-section'), or page name from the site manifest."
        }
      },
      "required": ["path"]
    }
  },
  {
    "name": "scan_visible_elements",
    "description": "Scans the active DOM and returns all interactive elements (buttons, inputs, selects, tabs, carousels, switches) with their selectors, data-wo-id, current values, and viewport visibility.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "includeOffscreen": {
          "type": "BOOLEAN",
          "description": "If true, scans interactive elements across the entire document, not just the current viewport."
        }
      }
    }
  },
  {
    "name": "read_page_content",
    "description": "Extracts semantic text, headings, pricing details, FAQs, table data, and manifest knowledge for a specific section or query so the agent can accurately answer user questions.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "query": {
          "type": "STRING",
          "description": "Optional topic, keyword, or question to filter page sections and manifest knowledge."
        },
        "selector": {
          "type": "STRING",
          "description": "Optional CSS selector of a specific section or card to read in detail."
        }
      }
    }
  },
  {
    "name": "guide_tour",
    "description": "Runs a multi-step visual walkthrough across multiple elements on the page, moving the ghost cursor and showing explanation callouts at each stop.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "steps": {
          "type": "ARRAY",
          "description": "Ordered list of tour stops ({ selector, explanation, dwellMs }).",
          "items": {
            "type": "OBJECT",
            "properties": {
              "selector": { "type": "STRING" },
              "explanation": { "type": "STRING" },
              "dwellMs": { "type": "INTEGER" }
            },
            "required": ["selector", "explanation"]
          }
        }
      },
      "required": ["steps"]
    }
  }
]
```

---

## 2. Closed-Loop Tool Response Format

Every tool execution returns a structured verification payload inside `toolResponse` so the voice model has immediate ground-truth feedback:

```json
{
  "toolResponse": {
    "functionResponses": [
      {
        "id": "call_123456",
        "name": "fill_form_field",
        "response": {
          "output": {
            "success": true,
            "action": "fill_form_field",
            "selector": "#contact-email",
            "currentValue": "ajay@example.com",
            "valid": true,
            "validationMessage": null,
            "viewportSummary": {
              "activeSection": "contact-section",
              "visibleInteractiveCount": 14
            }
          }
        }
      }
    ]
  }
}
```
