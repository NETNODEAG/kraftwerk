import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveProject } from "../config.js";
import {
  getConcept,
  initBundle,
  knowledgeRoot,
  listBundles,
  listConcepts,
  safeBundleName,
  verifyConcept,
  writeConcept,
  type BundleInfo,
  type ConceptDetail,
  type ConceptInfo,
} from "../okf.js";
import { getProjectRoot } from "./context.js";

/**
 * Context & Knowledge for the inspector: a thin API layer over the OKF
 * core (src/okf.ts). Writes from the UI are stamped as `human:user` — the
 * browser user is the human in the loop; agents write through the CLI (or
 * chat) with their own actor.
 */

export const UI_ACTOR = "human:user";

async function root(): Promise<string> {
  const project = await resolveProject(getProjectRoot());
  return knowledgeRoot(project.root, project.config.knowledge);
}

export interface KnowledgeIndex {
  root: string;
  bundles: BundleInfo[];
}

export interface BundleDetail {
  name: string;
  concepts: ConceptInfo[];
  /** Raw log.md, if the bundle keeps one. */
  log?: string;
}

export async function knowledgeIndex(): Promise<KnowledgeIndex> {
  const kroot = await root();
  return { root: kroot, bundles: await listBundles(kroot) };
}

export async function createBundle(name: string): Promise<BundleInfo> {
  await initBundle(await root(), name);
  return { name, concepts: 0 };
}

export async function bundleDetail(name: string): Promise<BundleDetail | null> {
  const kroot = await root();
  const dir = path.join(kroot, safeBundleName(name));
  if (!(await fs.stat(dir).catch(() => null))) return null;
  const log = await fs.readFile(path.join(dir, "log.md"), "utf8").catch(() => undefined);
  return { name, concepts: await listConcepts(kroot, name), log };
}

export async function conceptDetail(bundle: string, id: string): Promise<ConceptDetail | null> {
  return getConcept(await root(), bundle, id);
}

export async function putConcept(
  bundle: string,
  id: string,
  content: string
): Promise<ConceptDetail> {
  return (await writeConcept(await root(), bundle, id, content, UI_ACTOR)).concept;
}

export async function verifyFromUi(bundle: string, id: string): Promise<ConceptDetail> {
  return verifyConcept(await root(), bundle, id, UI_ACTOR);
}
