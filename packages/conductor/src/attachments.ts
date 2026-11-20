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

const ATTACHMENTS_DIR = join("conductor", "attachments");

const SAFE_ATTACHMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** How long a file nobody has sent yet is kept. */
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
   *  has grown. */
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

  const unsent = new Map<string, number>();

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
        sweep();
        writeFileSync(join(dir, chunk.id), body, { mode: 0o600 });
        path = realpathSync(join(dir, chunk.id));
      } else {
        if (!existsSync(chunk.appendTo)) {
          throw new ConductorRefused({
            why: `“${chunk.name}” has no file to append to on this host, so the upload was refused. Start it again.`,
          });
        }
        const real = realpathSync(chunk.appendTo);
        if (!real.startsWith(dir + sep) || basename(real) !== chunk.id) {
          throw new ConductorRefused({
            why: `“${chunk.name}” tried to continue into ${JSON.stringify(chunk.appendTo)}, which is not this attachment's file under this host's attachments directory.`,
          });
        }
        appendFileSync(real, body, { mode: 0o600 });
        path = real;
      }

      const bytes = statSync(path).size;
      unsent.set(chunk.id, Date.now());
      if (bytes > ATTACHMENT_BYTE_CAP) {
        rmSync(path, { force: true });
        unsent.delete(chunk.id);
        throw new ConductorRefused({
          why: attachmentTooBig(chunk.name, bytes),
        });
      }
      return { path, bytes };
    },
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
