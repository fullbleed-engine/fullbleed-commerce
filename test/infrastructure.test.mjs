// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRailwayContext } from 'railway/iac';
import configuration from '../.railway/railway.ts';

const production = { projectId: '6337f5dc-6602-48a3-acba-0286271471ea', environmentId: '432435d8-c0d2-4ad5-80ae-0c1444e7e1d1' };
const staging = { projectId: 'ee2c5784-260b-44d7-aff3-ef46714687bc', environmentId: 'b3892972-504b-493b-8fc4-a6fb26b14d90' };
const context = values => createRailwayContext({ command: 'plan', environment: 'production', ...values });

test('infrastructure refuses unknown projects and crossed or missing environment identities', () => {
  for (const input of [{}, { ...production, environmentId: staging.environmentId },
    { ...staging, environmentId: production.environmentId }, { projectId: production.projectId },
    { projectId: staging.projectId }, { ...production, projectId: '00000000-0000-4000-8000-000000000000' }]) {
    assert.throws(() => configuration(context(input)), /Link .* Fullbleed Commerce/);
  }
  assert.doesNotThrow(() => configuration(context(staging)));
  assert.doesNotThrow(() => configuration(context(production)));
});

test('unadmitted production infrastructure has no deploy source, public domain or Shopify credentials', () => {
  const project = configuration(context(production));
  const services = project.resources.filter(resource => resource.type === 'service');
  assert.equal(services.length, 1);
  const [service] = services;
  assert.equal(service.kind, 'empty');
  assert.equal(service.source, undefined);
  assert.equal(service.networking, undefined);
  assert.equal(service.domains, undefined);
  for (const name of ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_APP_URL', 'SHOPIFY_PARTNER_API_ACCESS_TOKEN']) {
    assert.equal(service.variables[name], undefined);
  }
  // The existing staging plan remains the only repository-connected service.
  const staged = configuration(context(staging)).resources.find(resource => resource.type === 'service');
  assert.equal(staged.source.type, 'github');
});
