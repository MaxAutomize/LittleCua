// Explicit opt-in live fixture launcher. Creates only an owned temporary .app;
// use the returned PID with cua_driver, then run this file with stop <directory>.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
const mode=process.argv[2] || 'start';
if(mode==='stop') {
  const directory=process.argv[3];
  if(!directory)throw new Error('stop requires exact fixture directory');
  const {pid,binary}=JSON.parse(readFileSync(join(directory,'fixture.json'),'utf8'));
  let actual='';try{actual=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();}catch{}
  if(actual && actual!==binary)throw new Error('Fixture PID identity changed; refusing to terminate another process');
  if(actual)process.kill(pid,'SIGTERM');
  rmSync(directory,{recursive:true,force:true});
  console.log('Owned fixture stopped and temporary bundle removed');
} else if(mode==='start') {
  if(process.platform!=='darwin')throw new Error('Live AppKit fixture requires macOS');
  const directory=mkdtempSync(join(tmpdir(),'pi-cua-panel-'));
  const app=join(directory,'NativePanelFixture.app'),contents=join(app,'Contents'),mac=join(contents,'MacOS');
  mkdirSync(mac,{recursive:true});
  const binary=join(mac,'NativePanelFixture');
  execFileSync('/usr/bin/swiftc',[fileURLToPath(new URL('./native-file-panel-fixture.swift',import.meta.url)),'-o',binary]);
  writeFileSync(join(contents,'Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>NativePanelFixture</string><key>CFBundleExecutable</key><string>NativePanelFixture</string><key>CFBundleIdentifier</key><string>org.pi.tests.native-panel-fixture</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>NSPrincipalClass</key><string>NSApplication</string></dict></plist>`);
  execFileSync('/usr/bin/codesign',['--force','--sign','-',app],{stdio:'pipe'});
  execFileSync('/usr/bin/open',['-n','-a',app]);
  let pid;
  for(let i=0;i<30&&!pid;i++){
    const lines=execFileSync('/bin/ps',['-axo','pid=,command='],{encoding:'utf8'}).split('\n');
    const line=lines.find(s=>s.trim().replace(/^\d+\s+/,'')===binary);
    if(line)pid=Number(line.trim().match(/^\d+/)[0]);
    else await new Promise(resolve=>setTimeout(resolve,100));
  }
  if(!pid)throw new Error(`Fixture did not start; inspect ${directory}`);
  const manifest={directory,pid,binary,app};
  writeFileSync(join(directory,'fixture.json'),JSON.stringify(manifest,null,2));
  console.log(JSON.stringify(manifest));
} else throw new Error('Usage: native-file-panel-fixture.mjs start | stop <directory>');
