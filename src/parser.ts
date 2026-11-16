import { unzipSync } from "fflate";
import { parseFlowXml } from "./flow.ts";
import type { Manifest, XNoteDocument } from "./types.ts";

const IMAGE_MIME: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
	m4a: "audio/mp4", aac: "audio/aac", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", opus: "audio/ogg", webm: "audio/webm",
};

function mimeFor(path: string): string {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_MIME[ext] ?? "application/octet-stream";
}

// Parse a raw .xnote (ZIP) file into its manifest, decoded image assets and flowing text.
export function parseXNote(data: ArrayBuffer): XNoteDocument {
	const files = unzipSync(new Uint8Array(data));

	const manifestBytes = files["manifest.json"];
	if (!manifestBytes) {
		throw new Error("Not a valid .xnote file: manifest.json is missing.");
	}

	let manifest: Manifest;
	try {
		manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
	} catch (e) {
		throw new Error(`Could not parse manifest.json: ${(e as Error).message}`);
	}

	if (!Array.isArray(manifest.pages)) {
		throw new Error("Not a valid .xnote file: manifest has no pages array.");
	}

	const flowBytes = files["flow.xml"];
	const flow = flowBytes ? parseFlowXml(new TextDecoder().decode(flowBytes)) : null;

	const assets = new Map<string, Blob>();
	const templates = new Map<string, unknown>();
	for (const [name, bytes] of Object.entries(files)) {
		if (name === "manifest.json" || name === "flow.xml" || name.endsWith("/")) continue;
		const templateMatch = /^templates\/([^/]+)\.xtemplate$/.exec(name);
		if (templateMatch) {
			// Only bounded, embedded plain JSON templates; never evaluate code.
			if (bytes.length <= 1024 * 1024) {
				try { templates.set(templateMatch[1], JSON.parse(new TextDecoder().decode(bytes))); }
				catch { /* unsupported packaged or corrupt template; leave the ruling blank */ }
			}
			continue;
		}
		// Copy into a fresh buffer so the Blob owns its bytes independently.
		assets.set(name, new Blob([bytes.slice()], { type: mimeFor(name) }));
	}

	return { manifest, assets, flow, templates };
}
