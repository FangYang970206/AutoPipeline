import { describe, expect, it } from 'vitest';
import {
  extractTemplateReferences,
  listTemplateCompletions,
  parseNamedOutputs,
  renameCommandReferences,
  renameUnitReferences,
  storeOutputs,
  substituteTemplate,
} from './namedOutputs';

describe('named output templates', () => {
  it('parses named outputs from stdout lines', () => {
    expect(parseNamedOutputs('first\n::set-output name=image_tag::v1.2.3\nlast')).toEqual({
      image_tag: 'v1.2.3',
    });
  });

  it('substitutes downstream references from the run context', () => {
    const context = storeOutputs({}, 'Build', 'Image', { tag: 'v1.2.3' });

    expect(substituteTemplate('deploy {{Build.Image.tag}}', context)).toBe('deploy v1.2.3');
  });

  it('fails clearly when a template reference is missing', () => {
    expect(() => substituteTemplate('deploy {{Build.Image.tag}}', {})).toThrow(
      'Unknown template reference: {{Build.Image.tag}}',
    );
  });

  it('extracts template references for validation and autocomplete', () => {
    expect(extractTemplateReferences('deploy {{ Build.Image.tag }}')).toEqual([
      { raw: '{{ Build.Image.tag }}', unitName: 'Build', commandName: 'Image', key: 'tag' },
    ]);
    expect(listTemplateCompletions({ Build: { Image: { tag: 'v1.2.3' } } })).toEqual(['{{Build.Image.tag}}']);
  });

  it('rewrites unit and command references when names change', () => {
    const renamedUnit = renameUnitReferences('deploy {{Build.Image.tag}}', 'Build', 'Package');

    expect(renamedUnit).toBe('deploy {{Package.Image.tag}}');
    expect(renameCommandReferences(renamedUnit, 'Package', 'Image', 'Container')).toBe(
      'deploy {{Package.Container.tag}}',
    );
  });
});
