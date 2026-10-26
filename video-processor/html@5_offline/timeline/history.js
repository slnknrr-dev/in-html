class History{constructor(limit=200,mergeMs=900){this.limit=limit;this.mergeMs=mergeMs;this.reset(null);}
reset(state){this.stack=state==null?[]:[{json:JSON.stringify(state),label:''}];this.pos=this.stack.length-1;this.lastMerge=null;}
commit(state,label='',merge=null,now=Date.now()){const json=JSON.stringify(state);if(this.pos>=0&&this.stack[this.pos].json===json)return false;this.stack.length=this.pos+1;const m=this.lastMerge;if(merge&&m&&m.key===merge&&now-m.at<this.mergeMs&&this.pos>0&&m.pos===this.pos){this.stack[this.pos]={json,label};m.at=now;return true;}
this.stack.push({json,label});if(this.stack.length>this.limit)this.stack.splice(0,this.stack.length-this.limit);this.pos=this.stack.length-1;this.lastMerge=merge?{key:merge,at:now,pos:this.pos}:null;return true;}
get canUndo(){return this.pos>0;}
get canRedo(){return this.pos<this.stack.length-1;}
get label(){return this.canUndo?this.stack[this.pos].label:'';}
get redoLabel(){return this.canRedo?this.stack[this.pos+1].label:'';}
undo(){if(!this.canUndo)return null;this.pos--;this.lastMerge=null;return JSON.parse(this.stack[this.pos].json);}
redo(){if(!this.canRedo)return null;this.pos++;this.lastMerge=null;return JSON.parse(this.stack[this.pos].json);}}
export{History};