class CellError{constructor(code){this.code=code;}
toString(){return this.code;}}
const FILE_ERRORS=['#NULL!','#DIV/0!','#VALUE!','#REF!','#NAME?','#NUM!','#N/A','#GETTING_DATA','#SPILL!','#CALC!'];const INTERN=new Map();for(const code of[...FILE_ERRORS,'#CIRC!','#ERROR!'])INTERN.set(code,new CellError(code));function cellError(code){const k=String(code).toUpperCase();let e=INTERN.get(k);if(!e){e=new CellError(k);INTERN.set(k,e);}
return e;}
const ERR={NULL:cellError('#NULL!'),DIV0:cellError('#DIV/0!'),VALUE:cellError('#VALUE!'),REF:cellError('#REF!'),NAME:cellError('#NAME?'),NUM:cellError('#NUM!'),NA:cellError('#N/A'),SPILL:cellError('#SPILL!'),CALC:cellError('#CALC!'),CIRC:cellError('#CIRC!'),ERROR:cellError('#ERROR!'),};