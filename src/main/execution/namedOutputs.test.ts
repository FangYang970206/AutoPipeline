import { describe, expect, it } from 'vitest';
import { parseNamedOutputs, storeOutputs, substituteTemplate } from './namedOutputs';

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
});
