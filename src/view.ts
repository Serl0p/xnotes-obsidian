import { finishRenderMath, FileView, loadPdfJs, Notice, Platform, WorkspaceLeaf, type TFile } from "obsidian";
import { flowMath, isEmptyFlow } from "./flow.ts";
import { layoutFlow, type PageFlow } from "./flowLayout.ts";
import { MathSetter } from "./math.ts";
import { parseXNote } from "./parser.ts";
import { renderPage, type PdfSource } from "./renderer.ts";
import { TextMeasurer } from "./text.ts";
import type { XNoteDocument, AudioItem } from "./types.ts";
import { resolveAppearance, type AppearanceSettings } from "./appearance.ts";
import type XNotesPlugin from "./main.ts";

export const VIEW_TYPE_XNOTE = "xnote-appearance-view";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.25;
const SOURCE_PDF = "assets/source.pdf";
const DEFAULT_DPI = 150;

interface PdfDocument extends PdfSource {
	destroy(): Promise<void>;
}

interface PdfJs {
	getDocument(params: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

interface AudioRecord { item:AudioItem; pageIndex:number; title:string; player:HTMLAudioElement; }
export class XNoteView extends FileView {
	private audioPanel!:HTMLElement;
	private audioPlayers:AudioRecord[]=[];
	private audioMarkers:{marker:HTMLButtonElement;record:AudioRecord}[]=[];
	private themeObserver:MutationObserver|null=null;
	private renderQueue:Promise<void>=Promise.resolve();
	private generation=0;
	private readonly plugin: XNotesPlugin;
	private doc: XNoteDocument | null = null;
	private assetUrls = new Map<string, string>();
	private pdf: PdfDocument | null = null;
	private readonly math = new MathSetter();
	private flowPages: PageFlow[] | null = null;
	private pagesEl!: HTMLElement;
	private zoomLabel!: HTMLElement;
	private zoom = 1;
	private fit = true;

	constructor(leaf: WorkspaceLeaf, plugin: XNotesPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_XNOTE;
	}

	getIcon(): string {
		return "pen-tool";
	}

	getDisplayText(): string {
		return this.file?.basename ?? "xNote";
	}

	protected async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("xnote-view");

		const bar = this.contentEl.createDiv({ cls: "xnote-toolbar" });
		const mkBtn = (label: string, title: string, onClick: () => void) => {
			const b = bar.createEl("button", { text: label, cls: "xnote-btn" });
			b.setAttribute("aria-label", title);
			b.onclick = onClick;
			return b;
		};
		mkBtn("Fit", "Fit page width", () => {
			this.fit = true;
			this.applyZoom();
		});
		mkBtn("-", "Zoom out", () => this.setZoom(this.zoom / ZOOM_STEP));
		this.zoomLabel = bar.createSpan({ cls: "xnote-zoom-label", text: "100%" });
		mkBtn("+", "Zoom in", () => this.setZoom(this.zoom * ZOOM_STEP));

		const controls=bar.createDiv({cls:"xnote-appearance-controls"});
		const select=<K extends "appearanceMode"|"neonMode">(label:string,key:K,options:[AppearanceSettings[K],string][])=>{
			const wrapper=controls.createEl("label",{cls:"xnote-appearance-mode"});
			wrapper.createSpan({text:label});
			const el=wrapper.createEl("select",{cls:"xnote-appearance-select"});
			el.setAttribute("aria-label",label);
			for(const [value,title] of options){const opt=el.createEl("option",{text:title});opt.value=value;}
			el.value=this.plugin.settings[key];
			el.onchange=()=>{const settings: AppearanceSettings=this.plugin.settings;settings[key]=el.value as AppearanceSettings[K];void this.changedAppearance();};
		};
		select("Page","appearanceMode",[["auto","Auto"],["original","Original"],["light","Light"],["dark","Dark"]]);
		for(const [label,key] of [["Paper","showPaper"],["Template","showTemplate"],["Contrast","adaptInk"]] as const){
			const wrapper=controls.createEl("label",{cls:"xnote-appearance-toggle"});
			const cb=wrapper.createEl("input");cb.type="checkbox";cb.checked=this.plugin.settings[key];
			wrapper.createSpan({text:label});
			cb.onchange=()=>{this.plugin.settings[key]=cb.checked;void this.changedAppearance();};
		}
		select("Neon","neonMode",[["auto","Auto"],["simple","Simplified"],["glow","Full glow"]]);
		this.audioPanel=this.contentEl.createDiv({cls:"xnote-audio-panel"});
		this.audioPanel.hidden=true;
		this.pagesEl = this.contentEl.createDiv({ cls: "xnote-pages" });
		const doc=this.contentEl.ownerDocument;
		let lastDark=this.isDark();
		this.themeObserver=new MutationObserver(()=>{
			const dark=this.isDark();if(dark===lastDark)return;lastDark=dark;
			if(this.plugin.settings.appearanceMode==="auto"||!this.plugin.settings.showPaper)void this.rerenderAppearance();
		});
		for(const node of [doc.body,doc.documentElement])this.themeObserver.observe(node,{attributes:true,attributeFilter:["class"]});

		this.registerDomEvent(window, "resize", () => {
			if (this.fit) this.applyZoom();
		});
		this.setupGestures();
	}

	// Pinch-to-zoom: trackpad pinch / ctrl+wheel on desktop, two-finger pinch on touch.
	private setupGestures(): void {
		this.registerDomEvent(
			this.pagesEl,
			"wheel",
			(e: WheelEvent) => {
				if (!e.ctrlKey) return; // plain wheel scrolls; pinch/ctrl zooms
				e.preventDefault();
				this.zoomAt(this.zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
			},
			{ passive: false },
		);

		let startDist = 0;
		let startZoom = 1;
		const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
		const mid = (t: TouchList): [number, number] => [
			(t[0].clientX + t[1].clientX) / 2,
			(t[0].clientY + t[1].clientY) / 2,
		];

		this.registerDomEvent(this.pagesEl, "touchstart", (e: TouchEvent) => {
			if (e.touches.length === 2) {
				startDist = dist(e.touches);
				startZoom = this.zoom;
			}
		});
		this.registerDomEvent(
			this.pagesEl,
			"touchmove",
			(e: TouchEvent) => {
				if (e.touches.length !== 2 || startDist === 0) return;
				e.preventDefault();
				const [mx, my] = mid(e.touches);
				this.zoomAt((startZoom * dist(e.touches)) / startDist, mx, my);
			},
			{ passive: false },
		);
		this.registerDomEvent(this.pagesEl, "touchend", (e: TouchEvent) => {
			if (e.touches.length < 2) startDist = 0;
		});
	}

	// Zoom to `z` while keeping the content point under (clientX, clientY) fixed.
	private zoomAt(z: number, clientX: number, clientY: number): void {
		const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
		const rect = this.pagesEl.getBoundingClientRect();
		const offX = clientX - rect.left;
		const offY = clientY - rect.top;
		const contentX = this.pagesEl.scrollLeft + offX;
		const contentY = this.pagesEl.scrollTop + offY;
		const ratio = target / this.zoom;

		this.fit = false;
		this.zoom = target;
		this.applyZoom();

		this.pagesEl.scrollLeft = contentX * ratio - offX;
		this.pagesEl.scrollTop = contentY * ratio - offY;
	}

	async onLoadFile(file: TFile): Promise<void> {
		const generation=++this.generation;
		this.clearAudio();
		this.revokeAssets();
		this.pagesEl.empty();
		this.doc = null;

		let data: ArrayBuffer;
		try {
			data = await this.app.vault.readBinary(file);
		} catch (e) {
			this.showError(`Could not read file: ${(e as Error).message}`);
			return;
		}

		if(generation!==this.generation)return;
		try {
			this.doc = parseXNote(data);
		} catch (e) {
			this.showError((e as Error).message);
			return;
		}

		for (const [name, blob] of this.doc.assets) {
			this.assetUrls.set(name, URL.createObjectURL(blob));
		}

		const pdfBlob = this.doc.assets.get(SOURCE_PDF);
		if (this.doc.manifest.has_pdf && pdfBlob) {
			try {
				const pdfjs = (await loadPdfJs()) as PdfJs;
				this.pdf = await pdfjs.getDocument({ data: new Uint8Array(await pdfBlob.arrayBuffer()) }).promise;
			} catch (e) {
				new Notice(`xNote: could not load the source PDF: ${(e as Error).message}`);
			}
		}

		if(generation!==this.generation)return;
		await this.layoutText();
		if(generation!==this.generation)return;
		this.setupAudio();
		await this.renderAll();
	}

	// Typeset every formula, then lay the flowing text across the pages against those sizes.
	private async layoutText(): Promise<void> {
		this.flowPages = null;
		if (!this.doc) return;
		const { manifest, flow } = this.doc;
		const formulas = flow ? flowMath(flow) : [];
		for (const page of manifest.pages) {
			for (const item of page.items) {
				if (item.kind === "text" && item.math && item.text) formulas.push({ latex: item.text, display: true });
			}
		}
		if (formulas.length > 0) {
			try {
				await this.math.prepare(formulas, this.contentEl.doc);
			} catch (e) {
				new Notice(`xNote: could not typeset maths: ${(e as Error).message}`);
			}
		}
		if (flow && !isEmptyFlow(flow)) {
			this.flowPages = layoutFlow(flow, manifest.pages, manifest.dpi ?? DEFAULT_DPI, new TextMeasurer(), this.math);
		}
	}

	async onUnloadFile(): Promise<void> {
		++this.generation;
		this.clearAudio();
		this.revokeAssets();
		this.pagesEl.empty();
		this.doc = null;
	}

	protected async onClose(): Promise<void> {
		++this.generation;
		this.themeObserver?.disconnect();
		this.clearAudio();
		this.revokeAssets();
		this.doc=null;
	}

	private isDark():boolean{
		const doc=this.contentEl.ownerDocument;
		return doc.body.classList.contains("theme-dark")||doc.documentElement.classList.contains("theme-dark");
	}
	private async changedAppearance():Promise<void>{
		try{await this.plugin.saveSettings();}catch(e){new Notice("xNotes: could not save appearance settings");}
		await this.rerenderAppearance();
	}
	private rerenderAppearance():Promise<void>{
		const generation=this.generation;
		this.renderQueue=this.renderQueue.catch(()=>{}).then(async()=>{
			if(generation===this.generation)await this.renderAll(true);
		});
		return this.renderQueue;
	}
	private clearAudio():void{
		for(const {player} of this.audioPlayers){player.pause();player.removeAttribute("src");player.load();}
		this.audioPlayers=[];this.audioMarkers=[];
		if(this.audioPanel){this.audioPanel.empty();this.audioPanel.hidden=true;}
	}
	private setupAudio():void{
		this.clearAudio();
		if(!this.doc)return;
		this.doc.manifest.pages.forEach((page,pageIndex)=>{
			for(const item of page.items){
				if(item.kind!=="audio"||typeof item.asset!=="string")continue;
				const url=this.assetUrls.get(item.asset);if(!url)continue;
				this.audioPanel.hidden=false;
				const row=this.audioPanel.createDiv({cls:"xnote-audio-row"});
				const title=item.name||`Recording ${this.audioPlayers.length+1}`;
				row.createSpan({cls:"xnote-audio-name",text:`Page ${pageIndex+1} · ${title}`});
				const player=row.createEl("audio",{cls:"xnote-audio-player"});
				player.controls=true;player.preload="metadata";player.src=url;
				const record={item,pageIndex,title,player};this.audioPlayers.push(record);
				player.onplay=()=>{for(const other of this.audioPlayers)if(other!==record)other.player.pause();this.updateAudioMarkers();};
				player.onpause=player.onended=()=>this.updateAudioMarkers();
			}
		});
	}
	private updateAudioMarkers():void{
		for(const {marker,record} of this.audioMarkers){
			const playing=!record.player.paused;
			marker.setText(playing?"❚❚":"▶");
			marker.setAttribute("aria-label",`${playing?"Pause":"Play"} ${record.title}`);
			marker.classList.toggle("is-playing",playing);
		}
	}
	private mountAudioMarkers(wrap:HTMLElement,index:number):void{
		for(const record of this.audioPlayers){
			if(record.pageIndex!==index)continue;
			const rect=record.item.rect;
			if(!Array.isArray(rect)||!Number.isFinite(rect[0])||!Number.isFinite(rect[1]))continue;
			const marker=wrap.createEl("button",{cls:"xnote-audio-marker",text:"▶"});
			marker.type="button";marker.dataset.x=String(rect[0]);marker.dataset.y=String(rect[1]);marker.title=record.title;
			marker.onclick=()=>{if(record.player.paused)void record.player.play().catch(e=>new Notice(`xNotes audio: ${e.message}`));else record.player.pause();};
			this.audioMarkers.push({marker,record});
		}
		this.updateAudioMarkers();
	}
	private async renderAll(preserveView=false): Promise<void> {
		if (!this.doc) return;
		const generation=this.generation;
		const doc=this.doc;
		const scrollX=this.pagesEl.scrollLeft,scrollY=this.pagesEl.scrollTop;
		this.audioMarkers=[];
		this.pagesEl.empty();
		const { manifest } = doc;
		const appearance=resolveAppearance(this.plugin.settings,this.isDark(),Platform.isMobile);
		if(!preserveView)this.fit = true;
		const scale = this.effectiveScale();

		for (let i = 0; i < manifest.pages.length; i++) {
			if(generation!==this.generation)return;
			const page = manifest.pages[i];
			const wrap = this.pagesEl.createDiv({ cls: "xnote-page" });
			const canvas = wrap.createEl("canvas");
			canvas.dataset.baseWidth = String(page.width);
			canvas.dataset.baseHeight = String(page.height);
			const layer = wrap.createDiv({ cls: "xnote-math-layer" });
			layer.setCssStyles({ width: `${page.width}px`, height: `${page.height}px` });
			const flowPage = this.flowPages?.[i];
			const text = this.doc.flow && flowPage ? { flow: this.doc.flow, page: flowPage } : null;
			try {
				const formulas = await renderPage(canvas, page, manifest.style, manifest.writer ?? 0, this.assetUrls, scale, this.pdf, text, this.math, appearance, doc.templates, manifest.dpi??DEFAULT_DPI);
				if(generation!==this.generation)return;
				for (const f of formulas) this.math.mount(layer, f);
			} catch (e) {
				wrap.setText(`Failed to render page ${i + 1}: ${(e as Error).message}`);
			}
			this.mountAudioMarkers(wrap,i);
		}
		await finishRenderMath();
		if(generation!==this.generation)return;
		this.applyZoom();
		if(preserveView){this.pagesEl.scrollLeft=scrollX;this.pagesEl.scrollTop=scrollY;}
	}

	private effectiveScale(): number {
		const dpr = window.devicePixelRatio || 1;
		return dpr * Math.max(1, this.plugin.settings.renderScale);
	}

	private setZoom(z: number): void {
		this.fit = false;
		this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
		this.applyZoom();
	}

	// Zoom is applied purely via CSS width so re-rendering is not needed on zoom.
	private applyZoom(): void {
		if (this.fit) {
			const first = this.pagesEl.querySelector("canvas");
			const avail = this.pagesEl.clientWidth - 24;
			if (first && avail > 0) {
				const base = Number(first.dataset.baseWidth) || first.width;
				this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, avail / base));
			}
		}
		this.pagesEl.querySelectorAll("canvas").forEach((canvas) => {
			const base = Number(canvas.dataset.baseWidth) || canvas.width;
			canvas.setCssStyles({ width: `${base * this.zoom}px`, height: "auto" });
		});
		this.pagesEl.querySelectorAll<HTMLElement>(".xnote-math-layer").forEach((layer) => {
			layer.setCssStyles({ transform: `scale(${this.zoom})` });
		});
		for(const {marker} of this.audioMarkers)marker.setCssStyles({left:`${Number(marker.dataset.x)*this.zoom}px`,top:`${Number(marker.dataset.y)*this.zoom}px`});
		this.zoomLabel.setText(`${Math.round(this.zoom * 100)}%`);
	}

	private showError(msg: string): void {
		this.pagesEl.empty();
		this.pagesEl.createDiv({ cls: "xnote-error", text: msg });
		new Notice(`xNote: ${msg}`);
	}

	private revokeAssets(): void {
		for (const url of this.assetUrls.values()) URL.revokeObjectURL(url);
		this.assetUrls.clear();
		void this.pdf?.destroy();
		this.pdf = null;
	}
}
