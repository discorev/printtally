import { AccountingDatabase } from 'print-accounting-database';
import { collectSnapshot } from 'print-accounting-ivec';
import type { CollectOptions, Snapshot, ImportResult } from 'print-accounting-contracts';
export class CollectionBusyError extends Error {}
export class AccountingService {
  db: AccountingDatabase;
  private collecting = false;
  private collector: typeof collectSnapshot;
  private getPassword: () => Promise<string>;
  constructor(db: AccountingDatabase, getPassword: () => Promise<string>, collector = collectSnapshot) { this.db = db; this.getPassword = getPassword; this.collector = collector; }
  get busy(): boolean { return this.collecting; }
  async collect(options: CollectOptions, progress?: (message: string) => void, getPassword = this.getPassword): Promise<{ snapshot: Snapshot; result: ImportResult }> {
    if (this.collecting) throw new CollectionBusyError('A collection is already running');
    this.collecting = true;
    let runId: number | undefined;
    try {
      runId = this.db.startImport('live', options.host);
      let snapshot: Snapshot;
      try { snapshot = await this.collector(options, getPassword, progress); }
      catch (error) { this.db.failImport(runId, 'collection_failed'); throw error; }
      let result: ImportResult;
      try { result = this.db.persistSnapshot(runId, snapshot); }
      catch (error) { this.db.failImport(runId, 'database_failed'); throw error; }
      this.db.attachAnnotations(runId, snapshot);
      return { snapshot, result };
    } finally { this.collecting = false; }
  }
}
