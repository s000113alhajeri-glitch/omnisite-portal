# R&D simulation scripts

Assumed sensor errors; results are not measurements. gen.py uses the OpenAI key from the environment (never stored in code).

## `drift_sim.py`

```python
import numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
rng=np.random.default_rng(7)
# path: loop around a 12 x 8 m hall, 1 m from the walls, plus a pass through the middle, back to start
pts=np.array([[1,1],[11,1],[11,7],[1,7],[1,4],[11,4],[11,1],[1,1]],float)
seg=[];step=0.05
for a,b in zip(pts[:-1],pts[1:]):
    n=int(np.linalg.norm(b-a)/step)
    seg.append(a+np.outer(np.arange(n)/n,b-a))
P=np.vstack(seg+[pts[-1:]]); D=np.r_[0,np.cumsum(np.linalg.norm(np.diff(P,axis=0),axis=1))]
markers=np.array([[1,1],[11,1],[11,7],[1,7],[6,4]],float)
RUNS=300; SCALE=0.015; GYRO=0.0012; NOISE=0.0008  # assumed phone drift: 1.5% scale, heading random walk, small jitter
def walk(mode):
    est=np.zeros_like(P); est[0]=P[0]; head=0; sc=1+rng.normal(0,SCALE)
    for i in range(1,len(P)):
        d=P[i]-P[i-1]; head+=rng.normal(0,GYRO); c,s=np.cos(head),np.sin(head)
        est[i]=est[i-1]+sc*np.array([c*d[0]-s*d[1],s*d[0]+c*d[1]])+rng.normal(0,NOISE,2)
        if mode in("markers","markers_laser"):
            m=np.linalg.norm(markers-P[i],axis=1)
            if m.min()<0.03: est[i]=P[i]+rng.normal(0,0.005,2); head*=0.2   # marker seen: position reset (marker measured to 0.5 cm)
        if mode=="markers_laser" and i%40==0:   # laser shot to nearest wall every 2 m: fixes the distance to that wall (0.2 cm)
            x,y=P[i]; walls=[(x,0),(12-x,0),(y,1),(8-y,1)]; dist,ax=min(walls)
            est[i,ax]=P[i,ax]+rng.normal(0,0.002)
        if mode=="dense" and i%40==0: est[i]=P[i]+rng.normal(0,0.005,2); head*=0.2
        if mode=="dense" and i%40==20:
            x,y=P[i]; walls=[(x,0),(12-x,0),(y,1),(8-y,1)]; dist,ax=min(walls); est[i,ax]=P[i,ax]+rng.normal(0,0.002)
    if mode=="loop":  # end = start is known: spread the end error back along the path
        err=est[-1]-P[-1]; est=est-np.outer(D/D[-1],err)
    return np.linalg.norm(est-P,axis=1)*100, est
modes=[("phone","Phone only","#d62728"),("loop","Phone + end where you started","#ff7f0e"),("markers","Phone + 5 markers","#2b6cff"),("markers_laser","Phone + markers + laser meter","#15803d"),("dense","Marker every 2 m + laser","#7c3aed")]
R={m:np.array([walk(m)[0] for _ in range(RUNS)]) for m,_,_ in modes}
fig,ax=plt.subplots(figsize=(10,5.2))
for m,l,c in modes:
    med=np.median(R[m],0);p90=np.percentile(R[m],90,0)
    ax.plot(D,med,color=c,lw=2.2,label=l);ax.fill_between(D,np.percentile(R[m],10,0),p90,color=c,alpha=.12)
ax.axhline(1,color="k",ls="--",lw=1);ax.text(D[-1]*0.995,1.15,"1 cm goal",ha="right",fontsize=9)
ax.set_xlabel("Metres walked");ax.set_ylabel("Position error (cm)");ax.set_yscale("log");ax.set_title("How far off the phone thinks it is, while walking a 12 × 8 m hall (300 simulated walks)")
ax.legend(loc="upper left");ax.grid(alpha=.3,which="both");fig.tight_layout();fig.savefig("/home/ubuntu/omni_docs/sim/1_error_vs_distance.png",dpi=150)
fig,ax=plt.subplots(figsize=(10,4.6));labels=[l for _,l,_ in modes];x=np.arange(len(modes))
mean=[R[m].mean() for m,_,_ in modes];p95=[np.percentile(R[m],95) for m,_,_ in modes];worst_end=[np.median(R[m].max(1)) for m,_,_ in modes]
b1=ax.bar(x-0.2,mean,0.4,color=[c for *_,c in modes],label="Average error");b2=ax.bar(x+0.2,p95,0.4,color=[c for *_,c in modes],alpha=.45,label="95% of the time below")
for bb in (b1,b2):
    for r in bb: ax.text(r.get_x()+r.get_width()/2,r.get_height()*1.05,f"{r.get_height():.1f} cm",ha="center",fontsize=9)
ax.axhline(1,color="k",ls="--",lw=1);ax.set_xticks(x,labels,fontsize=9);ax.set_yscale("log");ax.set_ylabel("cm (log scale)");ax.set_title("Position error by method");ax.legend();fig.tight_layout();fig.savefig("/home/ubuntu/omni_docs/sim/2_error_by_method.png",dpi=150)
fig,axs=plt.subplots(1,2,figsize=(11,4.4))
for a,(m,l,c) in zip(axs,[modes[0],modes[3]]):
    rng=np.random.default_rng(3); e,est=walk(m)
    a.plot(P[:,0],P[:,1],"k-",lw=1.5,label="Real path");a.plot(est[:,0],est[:,1],color=c,lw=1.5,label="What the phone thinks")
    a.scatter(markers[:,0],markers[:,1],marker="P",s=80,color="#15803d" if m!="phone" else "#bbb",label="Markers" if m!="phone" else "Markers (not used)")
    a.add_patch(plt.Rectangle((0,0),12,8,fill=False,lw=2));a.set_xlim(-0.6,12.6);a.set_ylim(-0.6,8.6);a.set_aspect("equal");a.set_title(f"{l}: max error {e.max():.1f} cm");a.legend(fontsize=8,loc="center right")
fig.suptitle("One example walk (hall 12 × 8 m)");fig.tight_layout();fig.savefig("/home/ubuntu/omni_docs/sim/3_example_walk.png",dpi=150)
for m,l,_ in modes: print(f"{l:34s} mean {R[m].mean():6.2f} cm  p95 {np.percentile(R[m],95):6.2f} cm  max(median run) {np.median(R[m].max(1)):6.2f} cm")
print("path length m", round(D[-1],1))

```

## `practical.py`

```python
import numpy as np
exec(open("drift_sim.py").read().split("modes=[")[0])  # path, params, walk()
machines=np.array([[3,1.6],[6,3.2],[9,3.4],[10.4,6],[4,6.4],[1.6,5.5],[8,1.6],[6,4.8]])  # 8 machine labels near the route (example)
walls=np.array([[6,0],[12,4],[6,8],[0,4]])  # 4 big A3 markers, one per wall
def walk2(mode):
    est=np.zeros_like(P); est[0]=P[0]; head=0; sc=1+rng.normal(0,SCALE); last=-99
    for i in range(1,len(P)):
        d=P[i]-P[i-1]; head+=rng.normal(0,GYRO); c,s=np.cos(head),np.sin(head)
        est[i]=est[i-1]+sc*np.array([c*d[0]-s*d[1],s*d[0]+c*d[1]])+rng.normal(0,NOISE,2)
        if np.linalg.norm(machines-P[i],axis=1).min()<0.7 and i-last>10:   # machine label read from ~0.7 m: 0.5 cm
            est[i]=P[i]+rng.normal(0,0.005,2); head*=0.2; last=i
        if mode>=2 and i%20==0:   # big wall marker in view: camera fix, error 0.3% of distance (assumed)
            dist=np.linalg.norm(walls-P[i],axis=1); k=dist.argmin()
            if dist[k]<7: est[i]=0.5*est[i]+0.5*(P[i]+rng.normal(0,0.003*dist[k],2))
        if mode>=3 and np.linalg.norm(pts-P[i],axis=1).min()<0.03:   # corner: 2 laser shots, both directions 0.2 cm
            est[i]=P[i]+rng.normal(0,0.002,2); head*=0.2
    return np.linalg.norm(est-P,axis=1)*100
for m,l in ((1,"Machine labels only"),(2,"+ 4 big wall markers"),(3,"+ laser shots at the corners")):
    R=np.array([walk2(m) for _ in range(300)]); print(f"{l:32s} mean {R.mean():5.2f} cm  p95 {np.percentile(R,95):5.2f} cm")

```

## `swarm.py`

```python
import numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from scipy.optimize import least_squares
rng=np.random.default_rng(5); L,W=12,8
def place(n):
    p=[]
    while len(p)<n:
        q=rng.uniform([0.3,0.3],[L-.3,W-.3])
        if np.linalg.norm(q-[6,4.2])>1.2: p.append(q)
    return np.array(p)
def blocked(a,b):  # mixer (r=1 m at 6,4.2) blocks the camera view
    c=np.array([6,4.2]); d=b-a; t=np.clip(np.dot(c-a,d)/np.dot(d,d),0,1); return np.linalg.norm(a+t*d-c)<1.0
def run(n,radio,cam,ruler,sr):
    X=place(n); X[1]=X[0]+[2.0,0]  # units 0 and 1 sit on a 2 m bar
    th=rng.uniform(-np.pi,np.pi,n); pairs=[(i,j) for i in range(n) for j in range(n) if i<j]
    R=[(i,j,np.linalg.norm(X[i]-X[j])+rng.normal(0,sr)) for i,j in pairs] if radio else []
    B=[(i,j,np.arctan2(*(X[j]-X[i])[::-1])-th[i]+rng.normal(0,np.radians(0.2))) for i in range(n) for j in range(n) if i!=j and cam and not blocked(X[i],X[j])]
    def res(v):
        P=v[:2*n].reshape(n,2); T=v[2*n:]; out=[]
        out+= [(np.linalg.norm(P[i]-P[j])-r)/sr for i,j,r in R]
        for i,j,b in B:
            e=np.arctan2(*(P[j]-P[i])[::-1])-T[i]-b; out.append(((e+np.pi)%(2*np.pi)-np.pi)/np.radians(0.2))
        if ruler: out.append((np.linalg.norm(P[1]-P[0])-2.0)/0.001)
        out+= [(P[0,0]-X[0,0])/1e-4,(P[0,1]-X[0,1])/1e-4,(P[1,1]-P[0,1])/1e-4]  # fix the frame: unit 0 = origin, bar sets the direction
        return np.array(out)
    v0=np.r_[(X+rng.normal(0,0.3,X.shape)).ravel(),th+rng.normal(0,0.1,n)]
    P=least_squares(res,v0,method="trf",x_scale="jac").x[:2*n].reshape(n,2)
    return np.sqrt(np.mean(np.sum((P-X)**2,1)))*100
Ns=[4,6,8,12,16,24]
cases=[("Radio only (10 cm boards)",1,0,0,0.10,"#d62728"),("Camera lights + 1 ruler",0,1,1,0.10,"#ff7f0e"),("Radio + camera + ruler",1,1,1,0.10,"#2b6cff"),("Better radio (3 cm) + camera + ruler",1,1,1,0.03,"#15803d")]
fig,ax=plt.subplots(figsize=(10,5.4)); rows=[]
for l,r,c,ru,sr,col in cases:
    m=[np.median([run(n,r,c,ru,sr) for _ in range(25)]) for n in Ns]; rows.append((l,m))
    ax.plot(Ns,m,"o-",color=col,lw=2.2,label=l)
    for n,v in zip(Ns,m): ax.text(n,v*1.12,f"{v:.1f}",ha="center",fontsize=8,color=col)
ax.axhline(1,color="k",ls="--",lw=1);ax.text(24,1.1,"1 cm goal",ha="right",fontsize=9)
ax.set_yscale("log");ax.set_xlabel("Number of landed units in the hall");ax.set_ylabel("Position error of each unit (cm, median)")
ax.set_title("Swarm simulation: hall 12 × 8 m, units land and measure each other (25 runs each)");ax.grid(alpha=.3,which="both");ax.legend(fontsize=9)
fig.tight_layout();fig.savefig("5_swarm_units.png",dpi=150)
for l,m in rows: print(f"{l:40s}"+"  ".join(f"N{n}:{v:5.2f}" for n,v in zip(Ns,m)))

```

## `layout.py`

```python
import numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
pts=np.array([[1,1],[11,1],[11,7],[1,7],[1,4],[11,4],[11,1],[1,1]],float)
seg=[];step=0.05
for a,b in zip(pts[:-1],pts[1:]):
    n=int(np.linalg.norm(b-a)/step); seg.append(a+np.outer(np.arange(n)/n,b-a))
P=np.vstack(seg+[pts[-1:]])
M=P[::40]; L=P[20::40]
fig,ax=plt.subplots(figsize=(11,7.6))
ax.add_patch(plt.Rectangle((0,0),12,8,fill=False,lw=3,color="#111"))
for x in np.arange(0,12.01,0.5): ax.plot([x,x],[0,8],color="#eee",lw=.6,zorder=0)
for y in np.arange(0,8.01,0.5): ax.plot([0,12],[y,y],color="#eee",lw=.6,zorder=0)
ax.plot(P[:,0],P[:,1],color="#2b6cff",lw=2,label="Engineer's walking route")
for i in range(0,len(P)-60,120):
    ax.annotate("",xy=P[i+30],xytext=P[i],arrowprops=dict(arrowstyle="->",color="#2b6cff",lw=1.6))
ax.scatter(M[:,0],M[:,1],marker="s",s=90,color="#15803d",zorder=5,label="QR marker (A-001, A-002…), about every 2 m")
for k,(x,y) in enumerate(M[:6]): ax.text(x+.15,y+.18,f"A-{k+1:03d}",fontsize=8,color="#15803d",weight="bold")
first=True
for x,y in L:
    walls=[(x,(0,y)),(12-x,(12,y)),(y,(x,0)),(8-y,(x,8))]; d,(wx,wy)=min(walls,key=lambda w:w[0])
    ax.plot([x,wx],[y,wy],color="#d62728",ls="--",lw=1.2,label="Laser shot to the nearest wall (about every 1 m)" if first else None); first=False
    ax.scatter([x],[y],marker="^",s=30,color="#d62728",zorder=4)
ax.scatter([0],[0],s=140,color="#d00",zorder=6); ax.text(.15,.15,"A1 corner (start of all measurements)",color="#d00",weight="bold",fontsize=9)
ax.add_patch(plt.Circle((6,6),.8,fill=False,color="#555",lw=1.5)); ax.text(6,6,"Mixer",ha="center",va="center",fontsize=9)
ax.add_patch(plt.Rectangle((8.3,5.3),1.6,1,fill=False,color="#555",lw=1.5)); ax.text(9.1,5.8,"Panel",ha="center",va="center",fontsize=9)
ax.set_xlim(-.5,12.5);ax.set_ylim(-.5,9.3);ax.set_aspect("equal");ax.set_xlabel("metres along the wall from A1");ax.set_ylabel("metres out from the wall")
ax.set_title(f"Hall 12 × 8 m from above: {len(M)} markers + {len(L)} laser shots on a 52 m walk (grey grid = 50 cm squares)")
ax.legend(loc="upper center",bbox_to_anchor=(.5,1.0),ncol=1,fontsize=9,framealpha=.95)
fig.tight_layout();fig.savefig("4_marker_layout.png",dpi=150);print(len(M),len(L))

```

## `scene3d.py`

```python
import numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
L,W,H=12,8,4
def hall(ax,title):
    for x in np.arange(0,L+.01,1): ax.plot([x,x],[0,W],[0,0],color="#ddd",lw=.5)
    for y in np.arange(0,W+.01,1): ax.plot([0,L],[y,y],[0,0],color="#ddd",lw=.5)
    for a,b in (([0,0],[0,W]),([0,L],[W,W])):
        ax.plot(a,b,[0,0],color="#555");ax.plot(a,b,[H,H],color="#bbb",lw=.8)
    for x,y in ((0,0),(0,W),(L,W)): ax.plot([x,x],[y,y],[0,H],color="#bbb",lw=.8)
    ax.scatter([0],[0],[0],s=90,color="#d00");ax.text(0,-.6,0,"A1",color="#d00",fontsize=11,weight="bold")
    t=np.linspace(0,2*np.pi,40)
    for cx,cy,lab in ((4,5.5,"M-001 Mixer 1"),(7,5.5,"M-002 Mixer 2")):
        for z in np.linspace(0,2.2,6): ax.plot(cx+.9*np.cos(t),cy+.9*np.sin(t),z,color="#2b6cff",lw=.8)
        for a in t[::5]: ax.plot([cx+.9*np.cos(a)]*2,[cy+.9*np.sin(a)]*2,[0,2.2],color="#2b6cff",lw=.6)
        ax.plot([cx,cx],[cy,cy],[2.2,3.1],color="#111",lw=4); ax.text(cx,cy,3.4,lab,fontsize=8,ha="center",color="#2b6cff",weight="bold")
    px,py=9.5,6.5
    for (a,b) in [((px,py,1),(px+.8,py,1)),((px,py,1.9),(px+.8,py,1.9)),((px,py,1),(px,py,1.9)),((px+.8,py,1),(px+.8,py,1.9))]: ax.plot(*zip(a,b),color="#111")
    ax.text(px+.4,py,2.1,"P-001 Panel",fontsize=8,ha="center")
    ax.set_xlim(0,L);ax.set_ylim(0,W);ax.set_zlim(0,H);ax.set_box_aspect((L,W,H));ax.view_init(24,-58);ax.set_axis_off();ax.set_title(title,fontsize=14,weight="bold")
# --- picture 1: site test
fig=plt.figure(figsize=(16,9));ax=fig.add_axes([0,0,.68,1],projection="3d");hall(ax,"Site test: phone + tripod markers + laser meter (nothing stuck on walls)")
trip=[(1.5,2,"A-001"),(10.5,2,"A-002"),(10.5,7.3,"A-003"),(1.5,7.3,"A-004")]
for x,y,n in trip:
    for dx,dy in ((-.3,-.3),(.3,-.3),(0,.35)): ax.plot([x+dx,x],[y+dy,y],[0,1.5],color="#555",lw=1.2)
    ax.plot([x-.3,x+.3,x+.3,x-.3,x-.3],[y]*5,[1.5,1.5,2.1,2.1,1.5],color="#15803d",lw=2.5); ax.text(x,y,2.35,n,ha="center",fontsize=9,color="#15803d",weight="bold")
route=np.array([[.8,.8],[11,.8],[11,3.8],[1,3.8],[1,7.5]]);ax.plot(route[:,0],route[:,1],0.02,color="#2b6cff",ls="--",lw=2);ax.text(6,.4,0,"walking route",color="#2b6cff",fontsize=9)
ex,ey=6,3.8;ax.plot([ex,ex],[ey,ey],[0,1.1],color="#111",lw=5);ax.scatter([ex],[ey],[1.7],s=260,color="#f2c29b",edgecolor="#111");ax.plot([ex,ex],[ey,ey],[1.1,1.55],color="#111",lw=5)
ax.scatter([ex+.25],[ey+.15],[1.35],s=50,marker="s",color="#111");ax.text(ex+.3,ey-.2,1.95,"Engineer: phone upright,\nchest height",fontsize=8)
for (x2,y2) in ((ex+.25,8),(L,ey)): ax.plot([ex+.25,x2],[ey+.15,y2],[1.35,1.35],color="#d62728",ls="--",lw=1.8)
ax.text(L-.3,ey+.3,1.5,"laser shot",color="#d62728",fontsize=8)
for x,y,z in ((3.1,5.5,1.0),(7.9,5.5,1.0),(9.5,6.5,1.9),(0,4,1.0),(12,6,1.2)): ax.scatter([x],[y],[z],marker="*",s=220,color="#f59e0b",edgecolor="#111")
ax.text(12,6.3,1.5,"check point",color="#b45309",fontsize=8)
fig.text(.69,.86,"Site test, step by step",fontsize=16,weight="bold")
st=["1. Corner A1 by the door = start of all measurements","2. Stand 4 tripods with A3 markers (A-001…A-004),\n    measure each from A1 with the laser meter","3. Tie labels on machines (M-001, P-001), scan,\n    nameplate photo, measure from A1","4. Walk slowly: phone upright, slow sweeps;\n    point at each marker 1 s (drift reset)","5. Corners: 2 laser shots (red dashed)","6. Check: 10 points (orange stars) measured\n    by hand vs the twin → pass = 9 of 10 within 1 cm","7. Repeat 3 times, take the tripods away"]
for i,s in enumerate(st): fig.text(.69,.78-i*.1,s,fontsize=11,va="top")
fig.savefig("6_site_test_3d.png",dpi=130)
# --- picture 2: swarm
fig=plt.figure(figsize=(16,9));ax=fig.add_axes([0,0,.68,1],projection="3d");hall(ax,"Drone swarm (proposed design): launch → land as beacons → capture → return")
ax.plot([.6,2.6],[.6,.6],[0,0],color="#111",lw=4);ax.text(1.6,.2,0,"2 m ruler bar",fontsize=8)
land=[(4,5.5,2.25),(7,5.5,2.25),(9.9,6.5,1.95),(.3,7.7,0),(11.7,7.7,0),(11.7,.3,0),(3,2,0),(8,2,0),(.3,3.5,0),(6,7.7,0),(11.7,4,0),(5.5,.3,0)]
for k,(x,y,z) in enumerate(land):
    ax.plot([1.2,x],[.6,y],[0.3,z+.6],color="#9ca3af",lw=.8,ls=":")
    ax.scatter([x],[y],[z+.05],s=70,color="#15803d",edgecolor="#111",zorder=6)
for i in range(len(land)):
    for j in range(i+1,len(land)):
        a,b=np.array(land[i]),np.array(land[j])
        if np.linalg.norm(a-b)<4.5: ax.plot(*zip(a+[0,0,.05],b+[0,0,.05]),color="#22c55e",lw=.5,alpha=.6)
for z,c in ((1.0,"#7c3aed"),(2.6,"#a855f7"),(3.5,"#c084fc")):
    xs=[];ys=[]
    for k,y in enumerate(np.arange(.8,W,1.6)):
        seq=[.8,L-.8] if k%2==0 else [L-.8,.8]; xs+=seq; ys+=[y,y]
    ax.plot(xs,ys,z,color=c,lw=1.3)
ax.scatter([5],[4.0],[2.6],s=160,marker="X",color="#7c3aed",edgecolor="#111");ax.text(5,4,2.95,"flying capture unit",fontsize=9,color="#7c3aed",weight="bold")
fig.text(.69,.86,"How the swarm moves",fontsize=16,weight="bold")
st=["1. Launch at the door (A1) from one case;\n    2 units stay on the 2 m ruler bar","2. Spread out slowly (grey dotted paths)","3. Land on safe spots: tank tops, panel, corners\n    (green dots) → fixed beacons, no drift","4. Beacons measure each other: radio distance +\n    camera sees blinking lights (green lines)","5. 1–2 units fly lanes at 3 heights\n    (purple), photos fixed by the beacons","6. Keep 1.5 m from tanks and people,\n    caged propellers, machines stopped","7. Return to the case: about 10–15 min,\n    nothing left on site → 3D twin in the CRM"]
for i,s in enumerate(st): fig.text(.69,.78-i*.1,s,fontsize=11,va="top")
fig.savefig("7_swarm_3d.png",dpi=130);print("ok")

```

## `video.py`

```python
import numpy as np, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt, matplotlib.animation as an, shutil
if not shutil.which("ffmpeg"):
    import imageio_ffmpeg; matplotlib.rcParams["animation.ffmpeg_path"]=imageio_ffmpeg.get_ffmpeg_exe()
rng=np.random.default_rng(11)
pts=np.array([[1,1],[11,1],[11,7],[1,7],[1,1]],float); step=0.1; seg=[]
for a,b in zip(pts[:-1],pts[1:]):
    n=int(round(np.linalg.norm(b-a)/step)); seg.append(a+np.outer(np.arange(n)/n,b-a))
P=np.vstack(seg+[pts[-1:]]); N=len(P)
dh=rng.normal(0,0.0035,N); jit=rng.normal(0,0.002,(N,2)); sc=1.02
def sim(mode):
    est=np.zeros_like(P); est[0]=P[0]; head=0; ev=[None]*N
    for i in range(1,N):
        d=P[i]-P[i-1]; head+=dh[i]; c,s=np.cos(head),np.sin(head)
        est[i]=est[i-1]+sc*np.array([c*d[0]-s*d[1],s*d[0]+c*d[1]])+jit[i]
        if mode and i%20==0: est[i]=P[i]; head=0; ev[i]=("m",i//20)
        elif mode and i%20==10:
            x,y=P[i]; w=min([(x,0,(0,y)),(12-x,0,(12,y)),(y,1,(x,0)),(8-y,1,(x,8))]); est[i,w[1]]=P[i,w[1]]; ev[i]=("l",w[2])
    return est,ev
E1,_=sim(False); E2,EV=sim(True)
AMP=3
fig,ax=plt.subplots(figsize=(10.8,7.6)); fig.subplots_adjust(top=.86,bottom=.04,left=.04,right=.96)
def base(title,sub):
    ax.clear(); ax.set_xlim(-.6,12.6); ax.set_ylim(-.6,8.9); ax.set_aspect("equal"); ax.axis("off")
    for x in np.arange(0,12.01,.5): ax.plot([x,x],[0,8],color="#eee",lw=.5,zorder=0)
    for y in np.arange(0,8.01,.5): ax.plot([0,12],[y,y],color="#eee",lw=.5,zorder=0)
    ax.add_patch(plt.Rectangle((0,0),12,8,fill=False,lw=3,color="#111"))
    ax.add_patch(plt.Circle((6,4.2),1,fill=False,color="#666",lw=1.5)); ax.text(6,4.2,"Mixer",ha="center",va="center",fontsize=10,color="#666")
    ax.add_patch(plt.Rectangle((8.6,3.6),1.6,1,fill=False,color="#666",lw=1.5)); ax.text(9.4,4.1,"Panel",ha="center",va="center",fontsize=10,color="#666")
    ax.scatter([0],[0],s=120,color="#d00",zorder=6); ax.text(.15,-.45,"Corner A1",color="#d00",fontsize=10,weight="bold")
    fig.suptitle(title,fontsize=17,weight="bold",y=.97); ax.set_title(sub,fontsize=11,color="#444",pad=4)
FR=[]
FR+= [("intro",k) for k in range(60)]
FR+= [("a",i) for i in range(0,N,2)]+[("a",N-1)]*45
FR+= [("mid",k) for k in range(60)]
FR+= [("b",i) for i in range(0,N,2)]+[("b",N-1)]*45
FR+= [("end",k) for k in range(90)]
def draw(f):
    kind,i=f
    if kind=="intro":
        base("How the phone gets lost, and how stickers fix it","Hall 12 × 8 m seen from above · grey squares = 50 cm")
        ax.text(6,6.4,"1. The engineer walks around the hall with the phone",ha="center",fontsize=13); ax.text(6,5.6,"2. Black = where he really is   ·   Red = where the phone thinks he is",ha="center",fontsize=12)
        ax.text(6,1.8,"(drift drawn 3× bigger so you can see it; the cm numbers are the real simulated values)",ha="center",fontsize=9,color="#777"); return
    if kind=="mid":
        base("Now: the same walk WITH stickers + laser","Green squares = QR stickers on the walls, measured once from A1")
        ax.text(6,6.3,"Every ~2 m: point the phone at a sticker → exact position",ha="center",fontsize=13); ax.text(6,5.5,"Halfway between: laser meter to the wall → one exact distance",ha="center",fontsize=13); return
    if kind=="end":
        e1=np.linalg.norm(E1-P,axis=1)*100; e2=np.linalg.norm(E2-P,axis=1)*100
        base("Result for this walk (32 m)","")
        ax.text(6,6,f"Phone only: up to {e1.max():.0f} cm off",ha="center",fontsize=18,color="#d62728",weight="bold")
        ax.text(6,4.6,f"With stickers + laser: up to {e2.max():.1f} cm off",ha="center",fontsize=18,color="#15803d",weight="bold")
        ax.text(6,2.8,"The stickers stay on the walls for every future visit.",ha="center",fontsize=13)
        ax.text(6,1.8,"Simulation with assumed phone drift, not measured on a real iPhone.",ha="center",fontsize=10,color="#777"); return
    E=E1 if kind=="a" else E2
    G=P[:i+1]+(E[:i+1]-P[:i+1])*AMP; err=np.linalg.norm(E[i]-P[i])*100
    base("Phone only: no stickers" if kind=="a" else "With stickers + laser meter", "Black = real position · Red = what the phone thinks")
    if kind=="b":
        for k in range(20,N,20):
            m=P[k]; x,y=m; w=min([(x,(m[0]-1+0.0,y)),(12-x,(12,y)),(y,(x,0)),(8-y,(x,8))]); sx,sy=(0.25 if x<1.5 else 11.75 if x>10.5 else x),(0.25 if y<1.5 else 7.75 if y>6.5 else y)
            done=k<=i; ax.scatter([sx],[sy],marker="s",s=110,color="#15803d" if done else "#9bd3ad",edgecolor="#0b5d2a",zorder=5)
            ax.text(sx,sy+.32,f"A-{k//20:03d}",ha="center",fontsize=7,color="#15803d")
    ax.plot(P[:i+1,0],P[:i+1,1],color="#111",lw=1.5); ax.plot(G[:,0],G[:,1],color="#d62728",lw=1.5,alpha=.8)
    ax.plot([P[i,0],G[-1,0]],[P[i,1],G[-1,1]],color="#d62728",ls=":",lw=1.2)
    ax.scatter([P[i,0]],[P[i,1]],s=160,color="#111",zorder=7); ax.text(P[i,0]+.2,P[i,1]+.25,"Engineer",fontsize=10,weight="bold")
    ax.scatter([G[-1,0]],[G[-1,1]],s=110,color="#d62728",zorder=7)
    ax.text(6,8.45,f"Phone is {err:.1f} cm off",ha="center",fontsize=15,weight="bold",color="#d62728" if err>3 else "#15803d")
    if kind=="b":
        for j in range(max(0,i-8),i+1):
            if EV[j] and EV[j][0]=="m":
                k=EV[j][1]; x,y=P[j]; sx,sy=(0.25 if x<1.5 else 11.75 if x>10.5 else x),(0.25 if y<1.5 else 7.75 if y>6.5 else y)
                ax.plot([x,sx],[y,sy],color="#15803d",lw=2); ax.text(6,2.2,f"Scanned sticker A-{k:03d} → position reset to exact",ha="center",fontsize=13,color="#15803d",weight="bold",bbox=dict(fc="white",ec="#15803d"))
            if EV[j] and EV[j][0]=="l":
                wx,wy=EV[j][1]; ax.plot([P[j,0],wx],[P[j,1],wy],color="#d62728",ls="--",lw=2); ax.text(6,2.2,"Laser shot to the wall → distance fixed",ha="center",fontsize=13,color="#d62728",weight="bold",bbox=dict(fc="white",ec="#d62728"))
a=an.FuncAnimation(fig,draw,frames=FR,interval=1000/30)
a.save("OmniSite_markers_explained.mp4",writer=an.FFMpegWriter(fps=30,bitrate=2500)); print("frames",len(FR))

```

## `gen.py`

```python
import json, urllib.request, base64, os, sys
key=os.environ["K"]
P={"8_site_test_realistic.png":"Photorealistic wide-angle photo inside a small industrial detergent factory hall in the UAE: two 4000-litre stainless steel mixing tanks with electric motors and agitators on top, a grey control panel box with red and green buttons on a railing, pipes, blue chemical drums, concrete floor. An engineer in a hard hat and hi-vis vest walks slowly holding a smartphone upright at chest height scanning the room; a small yellow laser distance meter clipped to the phone emits a thin red laser dot on the wall. Four light tripods stand around the hall, each holding an A3 white board with a large black QR-style square marker. A small QR label is tied on each tank. Natural daylight, documentary style, realistic.",
"9_swarm_realistic.png":"Photorealistic wide-angle photo inside a small industrial detergent factory hall: two stainless steel mixing tanks with motors on top, a control panel, concrete floor. About ten small palm-sized drones with protective propeller cages and small blinking green LEDs have landed on the tank tops, on top of the control panel and in the floor corners. One caged drone flies slowly at mid height taking photos. An engineer stands by the door holding an open hard case and a tablet showing a 3D blue wireframe map of the hall. Thin faint green light lines connect the drones to suggest measurement. Realistic, documentary style, natural light."}
for fn,pr in P.items():
    req=urllib.request.Request("https://api.openai.com/v1/images/generations",data=json.dumps({"model":"gpt-image-2","prompt":pr,"size":"1536x1024","quality":"medium","n":1}).encode(),headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=280) as r: d=json.loads(r.read())
        open(fn,"wb").write(base64.b64decode(d["data"][0]["b64_json"])); print("ok",fn)
    except urllib.error.HTTPError as e: print("err",fn,e.code,e.read()[:300])

```

