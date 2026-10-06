import { useId, useLayoutEffect, useRef, useState } from "react";

export interface CanvasBusinessNoticeData {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  input?: { label: string; initialValue: string; validate?: (value: string) => string | null };
}

export const CanvasBusinessNotice = ({ notice, onDecision }: {
  notice: CanvasBusinessNoticeData;
  onDecision: (accepted: boolean, value?: string) => void;
}) => {
  const titleId=useId(),messageId=useId();
  const panel=useRef<HTMLElement>(null);
  const initial=useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(notice.input?.initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const confirm = () => {
    if (!notice.input) { onDecision(true); return; }
    const message = notice.input.validate?.(value) ?? (!value.trim() ? "请输入名称。" : null);
    if (message) { setError(message); input.current?.focus(); return; }
    onDecision(true, value.trim());
  };
  useLayoutEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setValue(notice.input?.initialValue ?? ""); setError(null);
    if (notice.input) { input.current?.focus({preventScroll:true}); input.current?.select(); }
    else initial.current?.focus({preventScroll:true});
    return ()=>{if(previous?.isConnected && document.hasFocus())previous.focus({preventScroll:true});};
  },[notice]);
  return <div className="canvas-dialog-backdrop canvas-business-notice-backdrop" onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if(event.key==="Escape"){event.preventDefault();onDecision(false);}
    if(event.key==="Enter" && event.target===input.current){event.preventDefault();confirm();}
    if(event.key==="Tab"){
      const buttons=Array.from(panel.current?.querySelectorAll<HTMLElement>("input:not(:disabled), button:not(:disabled)")??[]);
      const at=buttons.indexOf(document.activeElement as HTMLButtonElement);
      if(buttons.length){event.preventDefault();buttons[(at+(event.shiftKey?-1:1)+buttons.length)%buttons.length].focus();}
    }
  }}>
    <section ref={panel} className="canvas-dialog canvas-dialog--business" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}>
      <h2 id={titleId}>{notice.title}</h2>
      <p id={messageId}>{notice.message}</p>
      {notice.input ? <label className="canvas-dialog__name-label">{notice.input.label}
        <input ref={input} value={value} onChange={event=>{setValue(event.target.value);setError(null);}}
          aria-label={notice.input.label} aria-invalid={!!error} />
        {error ? <span role="alert" className="canvas-dialog__name-error">{error}</span> : null}
      </label> : null}
      <div className="canvas-dialog__actions">
        {notice.cancelLabel ? <button ref={initial} type="button" onClick={()=>onDecision(false)}>{notice.cancelLabel}</button> : null}
        <button ref={notice.cancelLabel?undefined:initial} type="button" className={notice.danger?"is-danger":"is-primary"} onClick={confirm}>{notice.confirmLabel??"知道了"}</button>
      </div>
    </section>
  </div>;
};
