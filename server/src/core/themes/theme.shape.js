/**
 * Theme row -> API shape.
 *
 * Import-free so the tenant workspace can use it without a cycle. The API
 * answers camelCase everywhere; the snake_case row never leaves the server.
 */
export function shapeTheme(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    config: row.config,
    customCss: row.custom_css || '',
    isActive: Boolean(row.is_active),
    isPreset: Boolean(row.is_preset),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
