import type { RiskProtocols, MitigationTemplate, MatchedTrigger } from '@wo-agent/schemas';

/**
 * Look up a mitigation template by ID from risk protocols.
 * Returns null if not found.
 */
export function resolveMitigationTemplate(
  templateId: string,
  protocols: RiskProtocols,
): MitigationTemplate | null {
  return protocols.mitigation_templates.find(t => t.template_id === templateId) ?? null;
}

/**
 * Render user-facing mitigation messages for matched triggers.
 * Each message includes the template name, safety message, and instructions.
 */
export function renderMitigationMessages(
  matches: readonly MatchedTrigger[],
  protocols: RiskProtocols,
): string[] {
  const messages: string[] = [];

  for (const match of matches) {
    const template = resolveMitigationTemplate(match.trigger.mitigation_template_id, protocols);
    if (!template) continue;

    const instructions = template.safety_instructions
      .map(s => `- ${s}`)
      .join('\n');

    messages.push(
      `**${template.name}**\n\n${template.message_template}\n\n${instructions}`,
    );
  }

  return messages;
}
