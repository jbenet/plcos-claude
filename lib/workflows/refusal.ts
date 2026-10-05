/**
 * A workflow that refused before it did anything, for a reason the person can act on. Its message is
 * written for them and carries no record content, so the import receipt shows it as is (lib/import-jobs/store.ts).
 */
export class WorkflowRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowRefusal';
  }
}
