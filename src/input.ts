export type ControlMode='car'|'foot';

/** Touch stick radius in CSS pixels; a full push reaches the edge of the base. */
const STICK_RADIUS=52;
const STICK_DEADZONE=.14;

export class Input {
  keys=new Set<string>(); pressed=new Set<string>(); touch=new Set<string>();
  /** Analog touch stick, -1..1 on each axis. y is up-positive (push forward = +1). */
  stick={x:0,y:0};
  private stickPointer:number|null=null;
  private mode:ControlMode='car';
  private controller=new AbortController();
  constructor() {
    const options={signal:this.controller.signal};
    window.addEventListener('keydown',e=>{
      if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    },options);
    window.addEventListener('keyup',e=>this.keys.delete(e.code),options);
    window.addEventListener('blur',()=>this.clear(),options);
    document.querySelectorAll<HTMLButtonElement>('#touch-controls button').forEach(button=>{
      if(!button.dataset.key&&!button.dataset.keyCar)return;
      // Each press remembers the key it started with, so changing car/foot mid-press still releases it.
      let held:string|undefined;
      button.addEventListener('pointerdown',e=>{
        e.preventDefault();button.setPointerCapture(e.pointerId);
        held=this.keyFor(button);if(!held)return;
        this.touch.add(held);this.pressed.add(held);button.classList.add('held');navigator.vibrate?.(8);
      },options);
      const release=()=>{if(held)this.touch.delete(held);held=undefined;button.classList.remove('held');};
      for(const event of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(event,release,options);
      button.addEventListener('contextmenu',e=>e.preventDefault(),options);
    });
    this.bindStick(options);
  }
  /** Face buttons swap meaning between driving and walking, like the PS2 version. */
  setMode(mode:ControlMode){if(mode===this.mode)return;this.mode=mode;document.body.dataset.controlMode=mode;}
  private keyFor(button:HTMLButtonElement){return (this.mode==='foot'?button.dataset.keyFoot:button.dataset.keyCar)??button.dataset.key;}
  private bindStick(options:AddEventListenerOptions){
    const zone=document.getElementById('touch-stick');if(!zone)return;
    const base=zone.querySelector<HTMLElement>('.stick-base')!,knob=zone.querySelector<HTMLElement>('.stick-knob')!;
    let originX=0,originY=0;
    const move=(e:PointerEvent)=>{
      let dx=e.clientX-originX,dy=e.clientY-originY;const length=Math.hypot(dx,dy);
      if(length>STICK_RADIUS){dx*=STICK_RADIUS/length;dy*=STICK_RADIUS/length;}
      knob.style.transform=`translate(${dx}px,${dy}px)`;
      const magnitude=Math.min(1,length/STICK_RADIUS);
      if(magnitude<STICK_DEADZONE){this.stick.x=0;this.stick.y=0;return;}
      // Rescale past the dead zone so small pushes still give fine control.
      const scaled=(magnitude-STICK_DEADZONE)/(1-STICK_DEADZONE),angle=Math.atan2(dy,dx);
      this.stick.x=Math.cos(angle)*scaled;this.stick.y=-Math.sin(angle)*scaled;
    };
    const end=(e:PointerEvent)=>{
      if(e.pointerId!==this.stickPointer)return;this.stickPointer=null;
      this.stick.x=0;this.stick.y=0;knob.style.transform='';base.style.transform='';zone.classList.remove('active');
    };
    zone.addEventListener('pointerdown',e=>{
      if(this.stickPointer!==null)return;e.preventDefault();zone.setPointerCapture(e.pointerId);this.stickPointer=e.pointerId;
      // Floating stick: the base jumps to wherever the thumb lands inside the zone.
      const rest=base.getBoundingClientRect();
      originX=e.clientX;originY=e.clientY;
      base.style.transform=`translate(${e.clientX-(rest.left+rest.width/2)}px,${e.clientY-(rest.top+rest.height/2)}px)`;
      zone.classList.add('active');move(e);
    },options);
    zone.addEventListener('pointermove',e=>{if(e.pointerId===this.stickPointer)move(e);},options);
    for(const event of ['pointerup','pointercancel','lostpointercapture'] as const) zone.addEventListener(event,end,options);
  }
  down(...codes:string[]) {return codes.some(c=>this.keys.has(c)||this.touch.has(c));}
  consume(code:string) {const result=this.pressed.has(code);this.pressed.delete(code);return result;}
  /**
   * Walking direction from keys, touch stick or gamepad. The stick is snapped to 16 directions
   * and quarter steps because PlayerMovement re-reads the camera whenever the input changes.
   */
  get walk() {
    let x=(this.down('KeyD','ArrowRight')?1:0)-(this.down('KeyA','ArrowLeft')?1:0),z=(this.down('KeyW','ArrowUp')?1:0)-(this.down('KeyS','ArrowDown')?1:0);
    let run=this.down('ShiftLeft','ShiftRight');
    if(!x&&!z&&(this.stick.x||this.stick.y)){
      const magnitude=Math.hypot(this.stick.x,this.stick.y),step=Math.PI/8;
      const angle=Math.round(Math.atan2(this.stick.x,this.stick.y)/step)*step,level=Math.max(.25,Math.round(magnitude*4)/4);
      x=Math.round(Math.sin(angle)*level*1000)/1000;z=Math.round(Math.cos(angle)*level*1000)/1000;
      // Pushing the stick all the way runs, like analog pressure on the PS2.
      if(magnitude>.92)run=true;
    }
    return {x,z,run};
  }
  get controls() {
    const pad=Array.from(navigator.getGamepads?.()??[]).find(Boolean);
    const steer=(this.down('KeyD','ArrowRight')?1:0)-(this.down('KeyA','ArrowLeft')?1:0);
    const touchSteer=Math.sign(this.stick.x)*Math.pow(Math.abs(this.stick.x),1.4);
    return {steer:steer || touchSteer || (pad && Math.abs(pad.axes[0])>0.12 ? pad.axes[0] :0),
      throttle:this.down('KeyW','ArrowUp')?1:(pad?.buttons[7]?.value??0),
      brake:this.down('KeyS','ArrowDown')?1:(pad?.buttons[6]?.value??0),
      handbrake:this.down('Space')||!!pad?.buttons[0]?.pressed};
  }
  clear(){this.keys.clear();this.pressed.clear();this.touch.clear();this.stick.x=0;this.stick.y=0;}
  dispose(){this.controller.abort();this.clear();}
}
