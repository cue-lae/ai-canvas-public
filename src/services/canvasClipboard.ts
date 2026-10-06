import { validateCanvasClipboard, type CanvasClipboardContent, CanvasClipboardError } from "../domain/canvasClipboard";

export const CANVAS_CLIPBOARD_MIME = "application/x-ai-canvas-content";

export const encodeCanvasClipboard = (content: CanvasClipboardContent): string => JSON.stringify(validateCanvasClipboard(content));

/** Clipboard text is data, never code. Plain text from another application is
 * distinguished from a malformed package so the UI can give the right notice. */
export const decodeCanvasClipboard = (text: string): CanvasClipboardContent | null => {
  const normalized=text.replace(/^\uFEFF/,"").trim();
  if(!normalized.startsWith("{"))return null;
  let parsed:unknown;
  try{parsed=JSON.parse(normalized);}catch{return null;}
  if(!parsed || typeof parsed!=="object" || (parsed as {format?:unknown}).format!=="ai-canvas-clipboard")return null;
  return validateCanvasClipboard(parsed);
};

export const writeCanvasClipboard = async (content: CanvasClipboardContent, event?: ClipboardEvent): Promise<void> => {
  if(event){event.preventDefault();event.stopPropagation();}
  const encoded=encodeCanvasClipboard(content);
  if(event?.clipboardData){
    event.clipboardData.setData(CANVAS_CLIPBOARD_MIME,encoded);
    event.clipboardData.setData("text/plain",encoded);
    return;
  }
  if(!navigator.clipboard?.writeText)throw new CanvasClipboardError("invalid","当前环境无法写入剪贴板，尚未复制。");
  await navigator.clipboard.writeText(encoded);
};
