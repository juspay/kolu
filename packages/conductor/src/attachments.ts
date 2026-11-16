/**
 * A PROMPT'S FILES, ON THEIR WAY UP — the spool under `conductor.attach`,
 * and the one rule that decides when bytes may go.
 *
 * WHY THE BYTES ARRIVE IN PIECES AT ALL. A prompt carrying its own base64 is
 * one frame that scales with the file, and the RPC decoder does not fail an
 * oversized frame — it closes the socket with 1009 and takes every
 * subscription in the tab with it. The terminal's paste learned this in
 * production (`packages/client/src/terminal/pasteDelivery.ts`), and this is the
 * same shape: the sender cuts the base64 into frame-sized pieces, the first
 * creates, each later one appends to the path it was handed.
 *
 * THE RULE a file lives by is the transcript row that names it. That ties four
 * leaks shut at one seam — a record the row cap trimmed, a state-root whose
 * home moved and let the whole transcript go, a server that died between
 * writing the bytes and persisting the row that names them, and a prompt that
 * was REFUSED after its files had been uploaded. The one exception is an
 * upload younger than {@link UNSENT_ATTACHMENT_MS}: it has no row because
 * nobody has pressed Send yet.
 *
 * Its own module because it shares nothing with the conversation but the set
 * of ids the rows name — base64 chunking, `realpathSync` containment and a
 * retention window are not what a file about one ACP conversation is for.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, sep } from "node:path";
import {
  ATTACHMENT_BYTE_CAP,
  attachmentGone,
  attachmentTooBig,
  type ConductorAttachment,
  PROMPT_ATTACHMENT_BYTE_CAP,
  promptAttachmentsTooBig,
} from "kolu-common/conductor";
import { ConductorRefused } from "kolu-common/conductorErrors";
import type { Logger } from "pino";

/** Where a prompt's files land, under kolu-server's state root.
 *
 *  Beside `config.json` rather than inside it: an image is bytes, and bytes
 *  base64'd into the record would make every read of the state file — on
 *  every boot, for every reader — pay for a screenshot nobody is looking at.
 *  Its own directory under a `conductor/` corner so a person can see what
 *  the conversation is holding, and delete it, without a tool. */
const ATTACHMENTS_DIR = join("conductor", "attachments");

/** An id is the WHOLE filename, so it may be nothing but a filename. A
 *  browser that sent `../../id_rsa` would otherwise be choosing where this
 *  server writes; leading dots are out too, so neither `.` nor `..` can be
 *  spelled. Refused rather than sanitized — a name this end had to repair is
 *  a name the two ends no longer agree on. */
const SAFE_ATTACHMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** How long a file nobody has sent yet is kept.
 *
 *  THE RULE a file lives by is the transcript row that names it, and an
 *  upload that has not been sent has no row — so the only thing keeping it is
 *  that somebody may still press Send. That hope has a lifetime: a composer
 *  left open across a meeting still sends, an image pasted and thought better
 *  of does not outlive the afternoon. Without it the chunked upload is a leak
 *  with a wider mouth than the one it replaced — a person can attach three
 *  files and never send any of them, and nothing would ever name them.
 *
 *  What makes the directory grow is also what cleans it: the sweep runs on
 *  every upload that CREATES a file, so a server nobody is pasting into holds
 *  whatever it holds, and one that is pasted into reaps as it goes.
 *
 *  Exported so the test drives the window rather than re-spelling it: a
 *  retention rule nobody can wind the clock past is a rule nobody has
 *  checked. */
export const UNSENT_ATTACHMENT_MS = 60 * 60 * 1_000;

/** One chunk as the wire carries it. */
export interface AttachmentChunk {
  id: string;
  name: string;
  mimeType: string;
  data: string;
  /** The path a previous chunk of THIS attachment answered with. Absent on
   *  the first chunk, which creates the file. */
  appendTo?: string;
}

export interface Attachments {
  /** Take ONE CHUNK and put it on disk, answering where it is and how big it
   *  has grown. SEQUENTIAL per attachment: this appends to one growing file,
   *  so two chunks in flight at once interleave and corrupt it silently —
   *  which is also why it is synchronous rather than a promise. */
  readonly chunk: (chunk: AttachmentChunk) => {
    path: string;
    bytes: number;
  };
  /** The attachments a prompt NAMED, found on disk and measured. */
  readonly named: (
    attachments: ReadonlyArray<ConductorAttachment>,
  ) => ReadonlyArray<ConductorAttachment>;
  /** These ids are a transcript row's problem now (or nobody's): the upload's
   *  own protection is done. */
  readonly sent: (ids: ReadonlyArray<string>) => void;
  /** Reconcile the directory to the rows that still name a file, plus the
   *  uploads somebody may still send. */
  readonly sweep: () => void;
}

export const attachments = (deps: {
  readonly stateRoot: string;
  readonly log: Logger;
  /** The ids the transcript rows still name, or `null` before the record has
   *  been read — a sweep judging a restored state-root against an empty
   *  transcript would delete every file the conversation is still drawing. */
  readonly namedIds: () => ReadonlySet<string> | null;
}): Attachments => {
  const dirOf = (): string => join(deps.stateRoot, ATTACHMENTS_DIR);

  /** The uploads this server has taken that no row names YET — id to the
   *  moment the last chunk of it landed. An upload in progress is in here
   *  from its first chunk, which is what stops the sweep below from deleting
   *  a file out from under the chunk that is about to extend it. */
  const unsent = new Map<string, number>();

  /**
   * It runs on the RESTORE (the moment rows are LOST), on every upload that
   * creates a file (the moment the directory GROWS), after a prompt that was
   * refused (the moment files stop being destined for a row), and on the WIPE
   * (`clearSession`), which is the moment every row is lost at once. A
   * `newSession` is none of those and must not be: the divider says the
   * agent's memory was reset, not that the scroll above it was thrown away,
   * and the rows above it still draw their chips.
   *
   * A sweep that cannot read its own directory is WARNED about rather than
   * thrown from: what it would have cost is disk, and refusing to open the
   * conversation over that would cost the conversation.
   */
  const sweep = (): void => {
    const named = deps.namedIds();
    if (named === null) return;
    const dir = dirOf();
    if (!existsSync(dir)) return;
    const now = Date.now();
    try {
      for (const name of readdirSync(dir)) {
        if (named.has(name)) continue;
        const since = unsent.get(name);
        if (since !== undefined) {
          if (now - since < UNSENT_ATTACHMENT_MS) continue;
          unsent.delete(name);
        }
        rmSync(join(dir, name), { force: true });
      }
    } catch (err) {
      deps.log.warn(
        { err, dir },
        "kolu-server: the conductor could not sweep its attachments",
      );
    }
  };

  return {
    sweep,
    sent: (ids) => {
      for (const id of ids) unsent.delete(id);
    },
    /**
     * The writes are SYNCHRONOUS on purpose. An append is only correct if
     * nothing interleaves with it, and a sync write is the cheapest way to say
     * that about a handler the surface may enter twice — the sender is
     * sequential per attachment, and this is what happens when it is not.
     *
     * `appendTo` comes from the wire, so it is VALIDATED rather than trusted:
     * a continuation token that could name any path turns an upload into an
     * arbitrary-file append. It must resolve inside this state-root's
     * attachments directory and be this attachment's own file; `realpathSync`
     * resolves symlinks BEFORE the comparison, so a link planted in the
     * directory cannot point the append out of it.
     */
    chunk: (chunk) => {
      if (!SAFE_ATTACHMENT_ID.test(chunk.id)) {
        throw new ConductorRefused({
          why: `“${chunk.name}” came with the id ${JSON.stringify(chunk.id)}, which is not a name this server will write a file under.`,
        });
      }
      mkdirSync(dirOf(), { recursive: true });
      const dir = realpathSync(dirOf());
      const body = Buffer.from(chunk.data, "base64");
      let path: string;
      if (chunk.appendTo === undefined) {
        // THE CREATE, and the moment the directory grows — so it is where the
        // reaping happens. The write TRUNCATES: a second upload under the same
        // id is a file being sent again, not a file being doubled.
        sweep();
        writeFileSync(join(dir, chunk.id), body, { mode: 0o600 });
        path = realpathSync(join(dir, chunk.id));
      } else {
        // An append is only ever a CONTINUATION. A missing target is a protocol
        // violation rather than a first chunk, and it is checked before
        // `realpathSync`, which would otherwise throw a bare ENOENT that reads
        // as a crash instead of a refusal.
        if (!existsSync(chunk.appendTo)) {
          throw new ConductorRefused({
            why: `“${chunk.name}” has no file to append to on this host, so the upload was refused. Start it again.`,
          });
        }
        const real = realpathSync(chunk.appendTo);
        // `sep`-terminated prefix, so `/state/conductor/attachments` cannot
        // be matched by `/state/conductor/attachments-elsewhere`; and the
        // file must be this attachment's own, which is the id it was validated
        // under.
        if (!real.startsWith(dir + sep) || basename(real) !== chunk.id) {
          throw new ConductorRefused({
            why: `“${chunk.name}” tried to continue into ${JSON.stringify(chunk.appendTo)}, which is not this attachment's file under this host's attachments directory.`,
          });
        }
        appendFileSync(real, body, { mode: 0o600 });
        path = real;
      }
      // Measured from the FILE, after the write: the cap is enforced on what
      // this server actually holds, never on a chunk count or on what the
      // sender said it was sending. Per chunk rather than at the end, because
      // an upload that is refused only once it is finished has already cost the
      // disk it was refused for.
      const bytes = statSync(path).size;
      unsent.set(chunk.id, Date.now());
      if (bytes > ATTACHMENT_BYTE_CAP) {
        // Dropped rather than left half-written: a file the cap refused must
        // not be one a prompt can still name.
        rmSync(path, { force: true });
        unsent.delete(chunk.id);
        throw new ConductorRefused({
          why: attachmentTooBig(chunk.name, bytes),
        });
      }
      return { path, bytes };
    },
    /**
     * Nothing is written here — the bytes arrived chunk by chunk through
     * {@link Attachments.chunk}, and what a prompt carries is a name. The
     * `path` the caller sent is not read at all: the file is looked up by ID
     * under this server's own directory, so a path from the wire cannot choose
     * what the agent is handed, and `bytes` is re-read from the file so the
     * chip, the cap and the thing on disk are three readings of one number.
     *
     * The per-PROMPT cap lives here because this is the only place a message's
     * attachments are seen together; the per-attachment cap is enforced where
     * the bytes are written, which is the only place a growing file is seen at
     * all. The composer refuses first because refusing early is kinder, but
     * this is the end that has to live with the bytes, and a cap that only the
     * sender enforces is not a cap.
     */
    named: (named) => {
      if (named.length === 0) return named;
      const found: ConductorAttachment[] = [];
      let total = 0;
      for (const one of named) {
        if (!SAFE_ATTACHMENT_ID.test(one.id)) {
          throw new ConductorRefused({
            why: `“${one.name}” came with the id ${JSON.stringify(one.id)}, which is not a name this server will write a file under.`,
          });
        }
        const held = join(dirOf(), one.id);
        if (!existsSync(held)) {
          throw new ConductorRefused({
            why: attachmentGone(one.name),
          });
        }
        const path = realpathSync(held);
        const bytes = statSync(path).size;
        total += bytes;
        if (total > PROMPT_ATTACHMENT_BYTE_CAP) {
          throw new ConductorRefused({
            why: promptAttachmentsTooBig(total),
          });
        }
        found.push({ ...one, bytes, path });
      }
      return found;
    },
  };
};
