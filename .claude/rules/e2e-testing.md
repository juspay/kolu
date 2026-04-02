---
paths:
  - "tests/features/**"
---

## E2E Tests

- **Use semantic selectors**: Never match on CSS classes (`class*="bg-..."`) in test selectors — classes are styling concerns and break when visual design changes. Use `data-testid`, `data-active`, or other semantic `data-*` attributes instead.
