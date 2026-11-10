export type AppRecord = { id: string; name: string; publisher: string; category: string; installed: string; latest: string | null; status: string };
export const apps: AppRecord[] = [
  {id:'google-chrome',name:'Google Chrome',publisher:'Google LLC',category:'Web Browser',installed:'128.0',latest:'129.0',status:'Update Available'},
  {id:'microsoft-edge',name:'Microsoft Edge',publisher:'Microsoft Corporation',category:'Web Browser',installed:'129.0',latest:'129.0',status:'Up to Date'},
  {id:'vlc',name:'VLC Media Player',publisher:'VideoLAN',category:'Multimedia',installed:'3.0.20',latest:'3.0.21',status:'Update Available'},
  {id:'vscode',name:'Visual Studio Code',publisher:'Microsoft Corporation',category:'Developer Tool',installed:'1.93.0',latest:'1.93.0',status:'Up to Date'},
  {id:'git',name:'Git',publisher:'Git Development Community',category:'Developer Tool',installed:'2.45.0',latest:'2.46.0',status:'Update Available'},
  {id:'7zip',name:'7-Zip',publisher:'Igor Pavlov',category:'Utility',installed:'24.01',latest:'24.08',status:'Update Available'},
  {id:'notepad',name:'Notepad++',publisher:'Notepad++ Team',category:'Editor',installed:'8.6.0',latest:null,status:'Unknown'},
  {id:'example-utility',name:'Example Utility',publisher:'Unknown',category:'Utility',installed:'—',latest:null,status:'Unsupported'},
];
export const updateApps: AppRecord[] = [apps[0],apps[2],apps[4],apps[5],{...apps[3],installed:'1.92.0',status:'Update Available'}, {...apps[6],latest:'8.7.0',status:'Update Available'}, {id:'firefox',name:'Mozilla Firefox',publisher:'Mozilla Corporation',category:'Web Browser',installed:'129.0',latest:'130.0',status:'Update Available'}, {id:'python',name:'Python',publisher:'Python Software Foundation',category:'Runtime',installed:'3.11.0',latest:'3.12.0',status:'Update Available'}];
export function findApp(id: string) { return apps.find(app=>app.id===id) ?? updateApps.find(app=>app.id===id); }
export const history = [
  {id:'1',type:'SCAN',name:'Software Scan',description:'Scheduled routine system audit',date:'Oct 29, 2026',time:'10:30 AM',result:'Completed'},
  {id:'2',type:'UPDATE',name:'Google Chrome',description:'v118.0.5993.89 → v118.0.5993.117',date:'Oct 28, 2026',time:'3:15 PM',result:'Completed'},
  {id:'3',type:'UPDATE',name:'VLC Media Player',description:'Exit Code 1603 (Fatal install error)',date:'Oct 27, 2026',time:'11:20 AM',result:'Failed'},
  {id:'4',type:'SCAN',name:'Software Scan',description:'Automated morning inventory baseline',date:'Oct 26, 2026',time:'9:00 AM',result:'Completed'},
  {id:'5',type:'UPDATE',name:'Git',description:'v2.42.0 → v2.42.1 (Security Patch)',date:'Oct 25, 2026',time:'4:40 PM',result:'Completed'},
  {id:'6',type:'UPDATE',name:'7-Zip',description:'SHA-256 hash mismatch detected',date:'Oct 24, 2026',time:'2:10 PM',result:'Verification Failed'},
  {id:'7',type:'UPDATE',name:'Notepad++',description:'v8.5.7 → v8.5.8 (Files in use)',date:'Oct 23, 2026',time:'8:15 AM',result:'Restart Required'},
  {id:'8',type:'SCAN',name:'Software Scan',description:'User cancelled or network sleep',date:'Oct 22, 2026',time:'10:00 AM',result:'Interrupted'},
];
