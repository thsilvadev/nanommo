
import { Injectable, inject } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { environment } from '../../environments/environment';
import { AuthStore } from './auth.store';
import { Observable } from 'rxjs';
@Injectable({providedIn:'root'})
export class GameSocketService {
  private readonly auth=inject(AuthStore); private socket:Socket|null=null;
  connect():void{if(this.socket?.connected||!this.auth.accessToken())return;this.socket=io(`${environment.apiBaseUrl}/game`,{transports:['websocket'],auth:{token:this.auth.accessToken()},reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:1000});}
  disconnect():void{this.socket?.disconnect();this.socket=null;}
  get connected(){return !!this.socket?.connected;}
  on<T>(event:string):Observable<T>{return new Observable<T>(s=>{if(!this.socket){s.error(new Error('Game socket not connected'));return;}const h=(v:T)=>s.next(v);this.socket.on(event,h);return()=>this.socket?.off(event,h);});}
  onConnectionState():Observable<'connected'|'disconnected'|'reconnecting'>{return new Observable(s=>{if(!this.socket)return;const c=()=>s.next('connected'),d=()=>s.next('disconnected'),r=()=>s.next('reconnecting');this.socket.on('connect',c);this.socket.on('disconnect',d);this.socket.io.on('reconnect_attempt',r);if(this.socket.connected)s.next('connected');return()=>{this.socket?.off('connect',c);this.socket?.off('disconnect',d);this.socket?.io.off('reconnect_attempt',r);};});}
  emitFire(event:string,payload?:unknown):void{this.socket?.emit(event,payload);}
  emit<T=unknown>(event:string,payload?:unknown):Promise<T>{return new Promise((resolve,reject)=>{if(!this.socket){reject(new Error('Game socket not connected'));return;}this.socket.timeout(8000).emit(event,payload,(err:any,result:T)=>err?reject(err):resolve(result));});}
}
