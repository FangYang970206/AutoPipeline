import { describe, expect, it } from 'vitest';
import { validateTemplateReferences } from './templateValidation';

describe('validateTemplateReferences', () => {
  it('accepts references to declared upstream outputs', () => {
    expect(
      validateTemplateReferences({
        units: [
          { id: 'unit-a', name: 'Build' },
          { id: 'unit-b', name: 'Deploy' },
        ],
        edges: [{ source: 'unit-a', target: 'unit-b' }],
        commandsByUnit: new Map([
          ['unit-a', [{ id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Image', script: '::set-output name=tag::v1', serverId: null, shellType: 'cmd', onFailure: 'stop' } }]],
          ['unit-b', [{ id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Deploy', script: 'deploy {{Build.Image.tag}}', serverId: null, shellType: 'cmd', onFailure: 'stop' } }]],
        ]),
      }),
    ).toEqual([]);
  });

  it('rejects unknown, missing, parallel, and downstream references', () => {
    const errors = validateTemplateReferences({
      units: [
        { id: 'unit-a', name: 'Build' },
        { id: 'unit-b', name: 'Deploy' },
        { id: 'unit-c', name: 'Audit' },
      ],
      edges: [{ source: 'unit-a', target: 'unit-b' }],
      commandsByUnit: new Map([
        ['unit-a', [{ id: 'cmd-build', type: 'shell', order: 0, config: { name: 'Image', script: 'use {{Deploy.Release.tag}}', serverId: null, shellType: 'cmd', onFailure: 'stop' } }]],
        ['unit-b', [{ id: 'cmd-deploy', type: 'shell', order: 0, config: { name: 'Release', script: 'use {{Missing.Image.tag}} {{Audit.Check.tag}} {{Build.Image.missing}}', serverId: null, shellType: 'cmd', onFailure: 'stop' } }]],
        ['unit-c', [{ id: 'cmd-audit', type: 'shell', order: 0, config: { name: 'Check', script: '::set-output name=tag::ok', serverId: null, shellType: 'cmd', onFailure: 'stop' } }]],
      ]),
    });

    expect(errors).toEqual([
      'Unknown template output: {{Deploy.Release.tag}}',
      'Template reference is not upstream: {{Deploy.Release.tag}}',
      'Unknown template unit: Missing',
      'Template reference is not upstream: {{Audit.Check.tag}}',
      'Unknown template output: {{Build.Image.missing}}',
    ]);
  });
});
