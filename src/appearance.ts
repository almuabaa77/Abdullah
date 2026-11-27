export const paletteKeys = ['primary','accent','background','surface','text'] as const
export type Palette = Record<typeof paletteKeys[number],string>
export type Appearance = Palette & {iconVersion?:string}
export const defaultPalette:Palette = {primary:'#235848',accent:'#ead19b',background:'#f6f3ed',surface:'#fffefa',text:'#20352e'}

export function readPalette(input:unknown):Palette|undefined {
  if(!input||typeof input!=='object')return
  const value=input as Record<string,unknown>
  const palette={...defaultPalette}
  for(const key of paletteKeys){
    const color=value[key]
    if(typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color))return
    palette[key]=color.toLowerCase()
  }
  return palette
}

function contrast(a:string,b:string) {
  const luminance=(color:string)=>[0.2126,0.7152,0.0722].reduce((sum,weight,i)=>{
    const channel=parseInt(color.slice(1+i*2,3+i*2),16)/255
    return sum+weight*(channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4)
  },0)
  const x=luminance(a)+0.05,y=luminance(b)+0.05
  return Math.max(x,y)/Math.min(x,y)
}

export function readablePalette(p:Palette) {
  return contrast(p.primary,'#ffffff')>=4.5 && [p.surface,p.background].every(base=>contrast(p.text,base)>=4.5&&contrast(p.primary,base)>=4.5)
}

export const iconContentLimit=50_000
export const brandIconUrl=(version?:string)=>version?'/api/appearance/icon?v='+encodeURIComponent(version):'/assets/icon-64.png'

export function paletteVariables(p:Palette) {
  const mix=(color:string,amount:number,base:string)=>`color-mix(in srgb, ${color} ${amount}%, ${base})`
  return {
    '--green':p.primary,'--deep':mix(p.primary,72,'#000000'),'--focus':p.primary,'--gold':p.accent,
    '--bg':p.background,'--paper':p.surface,'--text':p.text,'--muted':mix(p.text,80,p.surface),
    '--surface':mix(p.background,55,p.surface),'--surface-strong':mix(p.primary,10,p.surface),
    '--soft':mix(p.primary,11,p.surface),'--border':mix(p.primary,16,p.surface),'--control-border':mix(p.primary,30,p.surface),
    '--appearance-role-tint':mix(p.primary,10,p.surface),'--appearance-role-edge':mix(p.primary,65,p.surface),
  }
}
