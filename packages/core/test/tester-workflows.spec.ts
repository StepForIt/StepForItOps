import { describe, expect, it } from 'vitest';
import { STUB_PREFIX, STUB_TAG, isStubWorkflow, stubWorkflowName } from '../src/domain/n8n/stub-workflow';
import { TEST_COPY_PREFIX, TEST_COPY_TAG, isTestCopy, testCopyName } from '../src/domain/n8n/test-copy';

describe('isStubWorkflow', () => {
  it('detects the stub tag', () => {
    expect(isStubWorkflow('Renommé à la main', [STUB_TAG])).toBe(true);
  });

  it('detects the name prefix, which is already the reuse key', () => {
    expect(isStubWorkflow(stubWorkflowName('Facturation'), [])).toBe(true);
    expect(isStubWorkflow(`${STUB_PREFIX} Facturation`, [])).toBe(true);
  });

  it('leaves ordinary workflows alone', () => {
    expect(isStubWorkflow('Facturation', ['crm'])).toBe(false);
    expect(isStubWorkflow('Bouchon de test', [])).toBe(false);
  });
});

describe('isTestCopy', () => {
  it('detects the tag posted at creation', () => {
    expect(isTestCopy([TEST_COPY_TAG])).toBe(true);
    expect(isTestCopy(['crm', TEST_COPY_TAG])).toBe(true);
  });

  it('ignores the name: a human may have written it', () => {
    // `[TEST] Facturation` sans tag est un vrai workflow, nommé à la main.
    expect(isTestCopy([])).toBe(false);
    expect(isTestCopy(['env:dev'])).toBe(false);
    expect(testCopyName('Facturation').startsWith(TEST_COPY_PREFIX)).toBe(true);
  });

  it('names the copy after the original', () => {
    expect(testCopyName('Facturation')).toBe('[TEST] Facturation');
  });
});
