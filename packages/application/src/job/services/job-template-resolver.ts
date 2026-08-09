/**
 * Template resolution for job/pipeline prompts and tool args. Moved to
 * @nusashell/domain (ticket #81, Klaster B); this file is a re-export shim so
 * existing application imports keep resolving.
 */
export {
  resolveTemplates,
  resolveTemplatesInRecord,
  templateContextFromEvent,
  type TemplateContext,
} from "@nusashell/domain";
