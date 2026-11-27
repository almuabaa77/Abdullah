const copyAllowed='input,textarea,[contenteditable]:not([contenteditable="false"]),[data-allow-copy]'

export function protectAppText() {
  function preventGestures(event:Event) {
    if(event.cancelable)event.preventDefault()
  }
  function protectCopy(event:ClipboardEvent) {
    const target=event.target instanceof Element?event.target:undefined
    if(target?.closest(copyAllowed))return
    const anchor=window.getSelection()?.anchorNode
    const from=anchor instanceof Element?anchor:anchor?.parentElement
    if(from?.closest('.app-shell')&&!from.closest(copyAllowed))event.preventDefault()
  }
  document.addEventListener('gesturestart',preventGestures,{passive:false})
  document.addEventListener('copy',protectCopy)
  return ()=>{
    document.removeEventListener('gesturestart',preventGestures)
    document.removeEventListener('copy',protectCopy)
  }
}
