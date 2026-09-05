const hex = (h) => [1,3,5].map((i)=>parseInt(h.slice(i,i+2),16)/255);
const lin = (c) => (c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)**2.4);
const L = (h) => { const [r,g,b]=hex(h).map(lin); return 0.2126*r+0.7152*g+0.0722*b; };
const ratio = (a,b) => { const l1=L(a), l2=L(b); const [hi,lo]=l1>l2?[l1,l2]:[l2,l1]; return (hi+0.05)/(lo+0.05); };

// Brettner/Viénot-Simulation für Deuteranopie und Protanopie (LMS-Weg)
const toLMS=(h)=>{const [r,g,b]=hex(h).map(lin);return [
  17.8824*r+43.5161*g+4.11935*b, 3.45565*r+27.1554*g+3.86714*b, 0.0299566*r+0.184309*g+1.46709*b];};
const fromLMS=([l,m,s])=>[
  0.0809444479*l-0.130504409*m+0.116721066*s,
 -0.0102485335*l+0.0540193266*m-0.113614708*s,
 -0.000365296938*l-0.00412161469*m+0.693511405*s];
const sim=(h,art)=>{const [l,m,s]=toLMS(h);
  const p=art==="deutan"?[l,0.494207*l+0*m+1.24827*s,s]:[2.02344*m-2.52581*s,m,s];
  return fromLMS(art==="deutan"?[l,p[1],s]:[p[0],m,s]);};
const dE=(a,b,art)=>{const x=sim(a,art),y=sim(b,art);
  return Math.sqrt(x.reduce((n,v,i)=>n+((v-y[i])*255)**2,0));};

const T={canvas:"#f3efe6",surface:"#fbf9f4",ink:"#141210","ink-2":"#4c4740","ink-3":"#6e685e",
  marke:"#0e4c46",onmarke:"#f3efe6",good:"#2c6a3f",bad:"#9a2a1e",warn:"#8f5d0a",info:"#33437a",
  "chart-1":"#0e4c46","chart-2":"#b0730f","line-strong":"#cbc3b1"};

let fehler=0;
const zeile=(name,r,min)=>{const ok=r>=min; if(!ok)fehler++;
  console.log(`${ok?"ok  ":"FEHL"}  ${name.padEnd(30)} ${r.toFixed(2)}:1  (min ${min})`);};

console.log("Text auf Fläche — WCAG AA 4.5:1");
for (const f of ["ink","ink-2","ink-3","marke","good","bad","warn","info"])
  for (const g of ["canvas","surface"]) zeile(`${f} auf ${g}`, ratio(T[f],T[g]), 4.5);
console.log("\nSchrift auf Markenfläche");
zeile("onmarke auf marke", ratio(T.onmarke,T.marke), 4.5);
console.log("\nGrafische Elemente — 3:1");
zeile("chart-1 auf surface", ratio(T["chart-1"],T.surface), 3);
zeile("chart-2 auf surface", ratio(T["chart-2"],T.surface), 3);
zeile("line-strong auf surface", ratio(T["line-strong"],T.surface), 1.4);
console.log("\nFarbfehlsichtigkeit — Trennung der Diagrammreihen (ΔE > 20)");
for (const art of ["deutan","protan"]) {
  const d=dE(T["chart-1"],T["chart-2"],art);
  console.log(`${d>20?"ok  ":"FEHL"}  chart-1 / chart-2 (${art}) ΔE ${d.toFixed(1)}`);
  if(d<=20)fehler++;
}
console.log(fehler? `\n${fehler} Punkt(e) verfehlt` : "\nalles bestanden");
process.exit(fehler?1:0);
