// Freestyle gomoku (15x15, five-or-more wins, no restrictions) forced-win solver.
// Black = attacker. Proves "black wins within d black moves" by AND/OR search:
//  - black moves: fours, threes (moves creating a double-five threat), and (budget q) quiet moves
//  - white moves: every reply that can matter (exact for threat nodes; all cells for free nodes)
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <climits>
#include <vector>
#include <string>
#include <algorithm>
#include <chrono>
using namespace std;

static const int N=15, NC=225, QMAX=4;
static const int DXv[4]={1,0,1,1}, DYv[4]={0,1,1,-1};
static int P3[9];
static uint8_t tFive[19683], tN5[19683];
static int tScore[19683];
static int bd[NC];
static int code_[2][NC][4];
static int nb[NC][4][9];
static int16_t rel[NC][NC];
static int stonesNear[NC];
static vector<int> nearList[NC];
static uint64_t zob[3][NC], hashKey=0;
static const uint64_t ZSIDE=0x9E3779B97F4A7C15ULL;

static void initTables(){
  P3[0]=1; for(int i=1;i<9;i++) P3[i]=P3[i-1]*3;
  static const int W[5]={1,6,36,216,1296};
  for(int code=0;code<19683;code++){
    int a[9]; int t=code; for(int i=0;i<9;i++){a[i]=t%3; t/=3;}
    tFive[code]=0;tN5[code]=0;tScore[code]=0;
    if(a[4]!=0) continue;
    a[4]=1;
    int L=0; for(int i=3;i>=0&&a[i]==1;i--) L++;
    int R=0; for(int i=5;i<9&&a[i]==1;i++) R++;
    if(L+R>=4) tFive[code]=1;
    int cnt=0;
    for(int i=0;i<9;i++){ if(i==4||a[i]!=0) continue;
      int l=0; for(int j=i-1;j>=0&&a[j]==1;j--) l++;
      int r=0; for(int j=i+1;j<9&&a[j]==1;j++) r++;
      if(l+r>=4) cnt++; }
    tN5[code]=(uint8_t)cnt;
    int sc=0;
    for(int s=0;s<=4;s++){ int own=0; bool ok=true; for(int j=s;j<s+5;j++){ if(a[j]==2){ok=false;break;} if(a[j]==1&&j!=4) own++; } if(ok) sc+=W[own]; }
    tScore[code]=sc;
  }
}
static void initBoard(){
  memset(bd,0,sizeof bd); hashKey=0; memset(stonesNear,0,sizeof stonesNear);
  for(int c=0;c<NC;c++) for(int e=0;e<NC;e++) rel[c][e]=-1;
  for(int c=0;c<NC;c++){ int x=c%N,y=c/N;
    for(int d=0;d<4;d++){ int cb=0;
      for(int i=0;i<9;i++){ int xx=x+(i-4)*DXv[d], yy=y+(i-4)*DYv[d];
        if(xx<0||xx>=N||yy<0||yy>=N){ nb[c][d][i]=-1; if(i!=4) cb+=2*P3[i]; }
        else { nb[c][d][i]=yy*N+xx; if(i!=4) rel[c][yy*N+xx]=(int16_t)(d*9+i); } }
      code_[0][c][d]=cb; code_[1][c][d]=cb; }
    nearList[c].clear();
    for(int dy=-2;dy<=2;dy++) for(int dx=-2;dx<=2;dx++){ int xx=x+dx,yy=y+dy; if(xx<0||xx>=N||yy<0||yy>=N) continue; nearList[c].push_back(yy*N+xx); }
  }
  uint64_t s=0x1234567887654321ULL;
  for(int k=0;k<3;k++) for(int c=0;c<NC;c++){ s^=s<<13; s^=s>>7; s^=s<<17; zob[k][c]=s; }
}
static inline void place(int c,int col){
  bd[c]=col; hashKey^=zob[col][c]; int own=col-1, opp=own^1;
  for(int d=0;d<4;d++){ const int* nbr=nb[c][d];
    for(int i=0;i<9;i++){ if(i==4) continue; int e=nbr[i]; if(e<0) continue; int p=P3[8-i]; code_[own][e][d]+=p; code_[opp][e][d]+=2*p; } }
  for(int e: nearList[c]) stonesNear[e]++;
}
static inline void unplace(int c){
  int col=bd[c]; bd[c]=0; hashKey^=zob[col][c]; int own=col-1, opp=own^1;
  for(int d=0;d<4;d++){ const int* nbr=nb[c][d];
    for(int i=0;i<9;i++){ if(i==4) continue; int e=nbr[i]; if(e<0) continue; int p=P3[8-i]; code_[own][e][d]-=p; code_[opp][e][d]-=2*p; } }
  for(int e: nearList[c]) stonesNear[e]--;
}
struct Scan{ uint8_t n5[2][NC]; int five[2][4]; int nfive[2]; };
static inline void scan(Scan& s){
  s.nfive[0]=s.nfive[1]=0;
  for(int c=0;c<NC;c++){
    if(bd[c]){ s.n5[0][c]=s.n5[1][c]=0; continue; }
    for(int p=0;p<2;p++){ const int* cd=code_[p][c];
      if(tFive[cd[0]]|tFive[cd[1]]|tFive[cd[2]]|tFive[cd[3]]){ if(s.nfive[p]<4) s.five[p][s.nfive[p]]=c; s.nfive[p]++; s.n5[p][c]=0; }
      else s.n5[p][c]=(uint8_t)(tN5[cd[0]]+tN5[cd[1]]+tN5[cd[2]]+tN5[cd[3]]);
    }
  }
}
static inline bool createsD(int m,const Scan& s){
  for(int d=0;d<4;d++){ const int* nbr=nb[m][d];
    for(int i=0;i<9;i++){ if(i==4) continue; int e=nbr[i]; if(e<0||bd[e]) continue;
      int old=code_[0][e][d]; int nw=old+P3[8-i];
      if(tFive[nw]) continue;
      if(s.n5[0][e]-tN5[old]+tN5[nw]>=2) return true; } }
  return false;
}
static inline int heur(int c,int p){ const int* a=code_[p][c]; return tScore[a[0]]+tScore[a[1]]+tScore[a[2]]+tScore[a[3]]; }

struct TTE{ uint64_t key; uint8_t win[QMAX+1]; uint8_t fail[QMAX+1]; uint8_t best[QMAX+1]; uint8_t pad[1]; };
static TTE* tt; static uint64_t ttMask;
static inline TTE* probe(uint64_t key){ TTE* e=&tt[key&ttMask]; return e->key==key? e: nullptr; }
static inline TTE* slot(uint64_t key){ TTE* e=&tt[key&ttMask]; if(e->key!=key){ memset(e,0,sizeof *e); e->key=key; } return e; }
static inline void storeWin(uint64_t key,int q,int d,int best){ TTE* e=slot(key); if(e->win[q]==0||d<e->win[q]){ e->win[q]=(uint8_t)d; if(best>=0) e->best[q]=(uint8_t)(best+1); } }
static inline void storeFail(uint64_t key,int q,int d,int best=-1){ TTE* e=slot(key); if(d>255)d=255; if(d>e->fail[q]) e->fail[q]=(uint8_t)d; if(best>=0&&e->win[q]==0) e->best[q]=(uint8_t)(best+1); }

static long long nodes=0, nodeLimit=LLONG_MAX; static bool aborted=false;
static int Kquiet=8, Rfree=0;
static int histW[NC]; static int killerB[256];
struct Mv{int c,sc;};
static inline bool mvCmp(const Mv&a,const Mv&b){ return a.sc>b.sc; }

static bool Wnode(int q,int d,int ply);
static bool Bnode(int q,int d,int ply,int* outMove=nullptr){
  if(aborted) return false;
  if(++nodes>nodeLimit){ aborted=true; return false; }
  if(d<=0) return false;
  uint64_t key=hashKey;
  TTE* e=probe(key); int ttBest=-1;
  if(e){
    for(int qq=0;qq<=q;qq++) if(e->win[qq]&&e->win[qq]<=d){ if(!outMove) return true; if(e->best[qq]){ *outMove=e->best[qq]-1; return true; } }
    if(!outMove) for(int qq=q;qq<=QMAX;qq++) if(e->fail[qq]>=d) return false;
    for(int qq=q;qq>=0;qq--) if(e->best[qq]){ ttBest=e->best[qq]-1; break; }
  }
  Scan s; scan(s);
  if(s.nfive[0]>0){ storeWin(key,0,1,s.five[0][0]); if(outMove)*outMove=s.five[0][0]; return true; }
  if(s.nfive[1]>=2){ storeFail(key,QMAX,255); return false; }
  if(s.nfive[1]==1){ int m=s.five[1][0]; place(m,1); bool r=Wnode(q,d-1,ply+1); unplace(m);
    if(aborted) return false; if(r){ storeWin(key,q,d,m); if(outMove)*outMove=m; } else storeFail(key,q,d); return r; }
  if(d<2){ storeFail(key,QMAX,1); return false; }
  for(int c=0;c<NC;c++) if(s.n5[0][c]>=2){ storeWin(key,0,2,c); if(outMove)*outMove=c; return true; }
  if(d<3){ storeFail(key,QMAX,2); return false; }
  if(q>0){ if(Bnode(q-1,d,ply,outMove)) return true; if(aborted) return false; }
  Mv mv[NC]; int n=0; bool isThreat[NC];
  for(int c=0;c<NC;c++){ isThreat[c]=false; if(bd[c]) continue;
    int sc;
    if(s.n5[0][c]>=1) sc = createsD(c,s)? 3000000:1000000;
    else if(createsD(c,s)) sc=2000000;
    else continue;
    isThreat[c]=true;
    sc += heur(c,0);
    if(c==ttBest) sc+=100000000; if(c==killerB[ply]) sc+=50000000;
    mv[n++]={c,sc};
  }
  sort(mv,mv+n,mvCmp);
  for(int i=0;i<n;i++){ int c=mv[i].c; place(c,1); bool r=Wnode(q,d-1,ply+1); unplace(c); if(aborted) return false;
    if(r){ storeWin(key,q,d,c); killerB[ply]=c; if(outMove)*outMove=c; return true; } }
  if(q>0){
    n=0;
    for(int c=0;c<NC;c++){ if(bd[c]||isThreat[c]||stonesNear[c]==0) continue;
      int sc=heur(c,0)*2+heur(c,1);
      if(c==ttBest) sc+=100000000; if(c==killerB[ply]) sc+=50000000;
      mv[n++]={c,sc}; }
    sort(mv,mv+n,mvCmp); if(n>Kquiet) n=Kquiet;
    for(int i=0;i<n;i++){ int c=mv[i].c; place(c,1); bool r=Wnode(q,d-1,ply+1); unplace(c); if(aborted) return false;
      if(r){ storeWin(key,q,d,c); killerB[ply]=c; if(outMove)*outMove=c; return true; } }
  }
  storeFail(key,q,d); return false;
}
// collect white replies at a node where black has double-five moves D[] (exact set of replies that can matter)
static int threatReplies(const Scan& s,const int* D,int nD,int* rep){
  bool mark[NC]; memset(mark,0,sizeof mark); int nr=0;
  for(int c=0;c<NC;c++) if(!bd[c]&&s.n5[1][c]>=1){ mark[c]=true; rep[nr++]=c; }
  int e0=D[0];
  for(int k=-1;k<36;k++){
    int x;
    if(k<0) x=e0; else { int d=k/9,i=k%9; if(i==4) continue; x=nb[e0][d][i]; }
    if(x<0||bd[x]||mark[x]) continue;
    bool ok=true;
    for(int j=0;j<nD&&ok;j++){ int e=D[j]; if(e==x) continue; int r=rel[e][x]; if(r<0){ok=false;break;}
      int d=r/9,i=r%9; int old=code_[0][e][d]; int nw=old+2*P3[i];
      if(s.n5[0][e]-tN5[old]+tN5[nw]>=2) ok=false; }
    if(ok){ mark[x]=true; rep[nr++]=x; }
  }
  return nr;
}
static int freeCells(int* out){
  int n=0;
  for(int c=0;c<NC;c++){ if(bd[c]) continue;
    if(Rfree>0){ int x=c%N,y=c/N; bool near=false;
      for(int dy=-Rfree;dy<=Rfree&&!near;dy++) for(int dx=-Rfree;dx<=Rfree;dx++){ int xx=x+dx,yy=y+dy; if(xx<0||xx>=N||yy<0||yy>=N) continue; if(bd[yy*N+xx]){near=true;break;} }
      if(!near) continue; }
    out[n++]=c; }
  return n;
}
static bool Wnode(int q,int d,int ply){
  if(aborted) return false;
  if(++nodes>nodeLimit){ aborted=true; return false; }
  if(d<=0) return false;
  uint64_t key=hashKey^ZSIDE;
  TTE* e=probe(key); int ttBest=-1;
  if(e){
    for(int qq=0;qq<=q;qq++) if(e->win[qq]&&e->win[qq]<=d) return true;
    for(int qq=q;qq<=QMAX;qq++) if(e->fail[qq]>=d) return false;
    for(int qq=q;qq>=0;qq--) if(e->best[qq]){ ttBest=e->best[qq]-1; break; }
  }
  Scan s; scan(s);
  if(s.nfive[1]>0){ storeFail(key,QMAX,255); return false; }
  if(s.nfive[0]>=2){ storeWin(key,0,1,-1); return true; }
  if(s.nfive[0]==1){ int x=s.five[0][0]; place(x,2); bool r=Bnode(q,d,ply+1); unplace(x); if(aborted) return false;
    if(r) storeWin(key,q,d,x); else storeFail(key,q,d,x); return r; }
  int D[NC], nD=0; for(int c=0;c<NC;c++) if(s.n5[0][c]>=2) D[nD++]=c;
  Mv mv[NC]; int n=0;
  if(nD>0){
    if(d<2){ storeFail(key,QMAX,1); return false; }
    int rep[NC]; int nr=threatReplies(s,D,nD,rep);
    for(int i=0;i<nr;i++){ int c=rep[i]; int sc=histW[c]; if(c==ttBest) sc+=100000000; mv[n++]={c,sc}; }
    sort(mv,mv+n,mvCmp);
    for(int i=0;i<n;i++){ int x=mv[i].c; place(x,2); bool r=Bnode(q,d,ply+1); unplace(x); if(aborted) return false;
      if(!r){ storeFail(key,q,d,x); histW[x]++; return false; } }
    storeWin(key,q,d,-1); return true;
  }
  if(q==0){ storeFail(key,0,255); return false; }
  if(!Bnode(q-1,d,ply+1)){ if(!aborted) storeFail(key,q,d); return false; }
  int cells[NC]; int nc=freeCells(cells);
  for(int i=0;i<nc;i++){ int c=cells[i]; int sc=histW[c]*1000+heur(c,0)+heur(c,1); if(sc>90000000) sc=90000000; if(c==ttBest) sc+=100000000; mv[n++]={c,sc}; }
  sort(mv,mv+n,mvCmp);
  for(int i=0;i<n;i++){ int x=mv[i].c; place(x,2); bool r=Bnode(q-1,d,ply+1); unplace(x); if(aborted) return false;
    if(!r){ storeFail(key,q,d,x); histW[x]+=4; return false; } }
  storeWin(key,q,d,-1); return true;
}

static string cellName(int c){ char buf[8]; snprintf(buf,sizeof buf,"%c%d",'A'+c%N,c/N+1); return buf; }
static int parseCell(const char* s){ int x=toupper(s[0])-'A'; int y=atoi(s+1)-1; if(x<0||x>=N||y<0||y>=N){ fprintf(stderr,"bad cell %s\n",s); exit(1);} return y*N+x; }
static int exactB(int q,int dmax){ for(int d=1;d<=dmax;d++){ if(Bnode(q,d,0)) return d; if(aborted) return 0; } return 0; }

static vector<pair<int,int>> line; // (cell,color)
static vector<string> notes;
static void pvW(int q,int d);
static void pvB(int q,int d){
  Scan s; scan(s);
  int m=-1; if(!Bnode(q,d,0,&m)||m<0){ printf("PV broken at black (q=%d d=%d)\n",q,d); return; }
  bool five=(s.nfive[0]>0);
  char buf[64]; snprintf(buf,sizeof buf,"B d=%d%s",d, five?" FIVE": (s.nfive[1]==1?" forced-block":(s.n5[0][m]>=2?" double-five":(s.n5[0][m]==1?(createsD(m,s)?" four+three":" four"):(createsD(m,s)?" three":" quiet")))));
  place(m,1); line.push_back({m,1}); notes.push_back(buf);
  if(!five) pvW(q,d-1);
  unplace(m);
}
static void pvW(int q,int d){
  if(d<=0) return;
  Scan s; scan(s);
  if(s.nfive[1]>0){ printf("PV: white can win?!\n"); return; }
  if(s.nfive[0]>=1){ int x=s.five[0][0]; place(x,2); line.push_back({x,2}); notes.push_back(s.nfive[0]>=2?"W forced(lost)":"W forced");
    int v=exactB(q,d); pvB(q,v); unplace(x); return; }
  int D[NC], nD=0; for(int c=0;c<NC;c++) if(s.n5[0][c]>=2) D[nD++]=c;
  int best=-1,bestv=-1,bestsc=-1; bool free_=false;
  int cand[NC]; int ncand=0;
  if(nD>0){ ncand=threatReplies(s,D,nD,cand); if(ncand==0){ cand[ncand++]=D[0]; } }
  else { if(q==0){ printf("PV: white free with q=0\n"); return; } free_=true; ncand=freeCells(cand); }
  int qq=free_? q-1:q;
  for(int i=0;i<ncand;i++){ int x=cand[i]; int sc=heur(x,1)+heur(x,0); if(!free_&&s.n5[1][x]>=1) sc-=1000000; // prefer blocks over counter-fours on ties
    place(x,2); int v=exactB(qq,d); unplace(x);
    if(v==0){ printf("PV: reply %s not refuted within d=%d!\n",cellName(x).c_str(),d); v=999; }
    if(v>bestv||(v==bestv&&sc>bestsc)){ best=x;bestv=v;bestsc=sc; } }
  char buf[64]; snprintf(buf,sizeof buf,"W %s v=%d (%d cand)", free_?"free":(s.n5[1][best]>=1?"counter-four":"block"), bestv, ncand);
  if(bestv>d){ printf("PV broken at white\n"); return; }
  place(best,2); line.push_back({best,2}); notes.push_back(buf);
  pvB(qq,bestv); unplace(best);
}

int main(int argc,char** argv){
  if(argc<7){ fprintf(stderr,"usage: %s cmd q maxd K R limitM moves...\n",argv[0]); return 1; }
  string cmd=argv[1]; int q=atoi(argv[2]); int maxd=atoi(argv[3]); Kquiet=atoi(argv[4]); Rfree=atoi(argv[5]); long long lim=atoll(argv[6])*1000000LL;
  initTables(); initBoard();
  ttMask=(1ULL<<22)-1; tt=(TTE*)calloc(ttMask+1,sizeof(TTE));
  for(int i=0;i<256;i++) killerB[i]=-1;
  int nm=0; vector<int> ms;
  for(int i=7;i<argc;i++){ int c=parseCell(argv[i]); if(bd[c]){ fprintf(stderr,"occupied %s\n",argv[i]); return 1;} place(c,(nm%2==0)?1:2); ms.push_back(c); nm++; }
  bool blackToMove=(nm%2==0);
  auto t0=chrono::steady_clock::now();
  auto el=[&](){ return chrono::duration<double>(chrono::steady_clock::now()-t0).count(); };
  if(cmd=="solve"){
    int res=0; nodeLimit=lim;
    for(int d=1;d<=maxd;d++){ bool r= blackToMove? Bnode(q,d,0): Wnode(q,d,0);
      printf("d=%d %s nodes=%lld t=%.1fs\n",d,r?"WIN":(aborted?"ABORT":"-"),nodes,el()); fflush(stdout);
      if(r){res=d;break;} if(aborted) break; }
    if(res){ nodeLimit=LLONG_MAX; line.clear(); notes.clear(); if(blackToMove) pvB(q,res); else pvW(q,res);
      printf("PV:"); for(auto&p:line) printf(" %s", cellName(p.first).c_str()); printf("\n");
      for(size_t i=0;i<line.size();i++) printf("  %s %s  [%s]\n", line[i].second==1?"B":"W", cellName(line[i].first).c_str(), notes[i].c_str());
      printf("RESULT black wins within %d black moves; t=%.1fs nodes=%lld\n",res,el(),nodes); }
    else printf("RESULT not proven\n");
  } else if(cmd=="wlist"||cmd=="blist"){
    bool w=(cmd=="wlist"); if(w==blackToMove){ fprintf(stderr,"wrong side to move\n"); return 1; }
    int cells[NC]; int save=Rfree; int nc; { int r2=Rfree; if(r2==0) r2=2; Rfree=r2; nc=freeCells(cells); Rfree=save; }
    vector<pair<int,string>> out;
    for(int i=0;i<nc;i++){ int c=cells[i]; place(c,w?2:1); aborted=false; long long n0=nodes; nodeLimit=nodes+lim; int res=0;
      for(int d=1;d<=maxd;d++){ bool r= w? Bnode(q,d,0): Wnode(q,d,0); if(r){res=d;break;} if(aborted) break; }
      unplace(c);
      char buf[128]; snprintf(buf,sizeof buf,"%s %s nodes=%lld t=%.1f",cellName(c).c_str(), res? (string("win<=")+to_string(res)).c_str(): (aborted?"ABORT":"none"), nodes-n0, el());
      printf("%s\n",buf); fflush(stdout); }
  }
  return 0;
}
