# Inventory SKU CSV Import (Shopify Export)

The Inventory → SKUs page accepts Shopify’s product export CSV. It creates products and SKUs scoped to the
current company, skipping any duplicate SKUs that already exist.

## Required columns (header names)

The importer looks for these headers (case-insensitive):

- `Variant SKU`
- `Title`
- `Option1 Value (Size)` (Shopify often exports as `Option1 Value`)
- `Option2 Value (Color)` (Shopify often exports as `Option2 Value`)

## Optional columns

- `Cost per item`

## Row handling rules

- **Group by Title**: if a product with the same title does not exist, it is created.
- **SKU uniqueness**: if a SKU already exists for the company, that row is skipped and recorded as a duplicate.
- **Costs**: `Cost per item` is imported if present and numeric; invalid costs are flagged as errors.

## Example (subset)

```csv
Handle,Title,Variant SKU,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Cost per item
one-piece-swimsuit,MBPS06 - One Piece Swimsuit,MBPS06-NAVY-M,Size,M,Color,Navy,249.5
one-piece-swimsuit,MBPS06 - One Piece Swimsuit,MBPS06-NAVY-L,Size,L,Color,Navy,249.5
```
