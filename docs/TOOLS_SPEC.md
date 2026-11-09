# WebOrient Live API Tool Specification

These tool declarations are registered in the `tools` array of the Gemini Multimodal Live API session. As the voice agent talks to the user, it calls these tools to execute DOM actions concurrently.

---

## 1. Tool Declarations

```json
[
  {
    "name": "move_and_highlight",
    "description": "Smoothly moves the ghost cursor to a DOM element and surrounds it with a glowing spotlight border to draw user attention.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "selector": {
          "type": "STRING",
          "description": "CSS selector of the element to highlight, e.g. '#pricing-card-pro' or 'button[type=submit]'."
        },
        "explanation": {
          "type": "STRING",
          "description": "Short description of what is being pointed out."
        }
      },
      "required": ["selector"]
    }
  },
  {
    "name": "click_element",
    "description": "Glides the ghost cursor to a button, tab, or link, performs a visible click ripple animation, and triggers the DOM click event.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "selector": {
          "type": "STRING",
          "description": "CSS selector of the clickable element."
        }
      },
      "required": ["selector"]
    }
  },
  {
    "name": "fill_form_field",
    "description": "Fills text into an input field or textarea character-by-character with a typewriter animation and dispatches native browser change events.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "selector": {
          "type": "STRING",
          "description": "CSS selector of the input field, e.g. '#email-input'."
        },
        "value": {
          "type": "STRING",
          "description": "The exact string value to fill into the field."
        }
      },
      "required": ["selector", "value"]
    }
  },
  {
    "name": "scroll_page",
    "description": "Smoothly scrolls the browser viewport up, down, or directly to an element or section.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "direction": {
          "type": "STRING",
          "enum": ["up", "down", "top", "bottom"],
          "description": "Direction of scroll when no specific element selector is provided."
        },
        "targetSelector": {
          "type": "STRING",
          "description": "Optional CSS selector to scroll directly into the center of the viewport."
        }
      }
    }
  },
  {
    "name": "navigate_route",
    "description": "Navigates the user to a different URL or page route on the website.",
    "parameters": {
      "type": "OBJECT",
      "properties": {
        "path": {
          "type": "STRING",
          "description": "The relative or absolute route path to navigate to, e.g. '/pricing' or '/contact'."
        }
      },
      "required": ["path"]
    }
  },
  {
    "name": "scan_visible_elements",
    "description": "Requests an immediate refresh of actionable elements currently visible in the user's viewport.",
    "parameters": {
      "type": "OBJECT",
      "properties": {}
    }
  }
]
```

---

## 2. Tool Response Format

When the client SDK finishes executing a tool, it returns a `toolResponse` frame back to the WebSocket:

```json
{
  "toolResponse": {
    "functionResponses": [
      {
        "response": {
          "output": {
            "success": true,
            "elementFound": true,
            "action": "fill_form_field",
            "selector": "#email-input"
          }
        },
        "id": "call_123456"
      }
    ]
  }
}
```
