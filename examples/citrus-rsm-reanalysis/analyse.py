#!/usr/bin/env python3
"""Reproduce the citrus-oil Box-Behnken reanalysis.

Data are transcribed reported values, not instrument-level raw observations.
No response is removed from the primary fit. Deletion runs are diagnostics only.
Units: predicted yields, residuals and differences are percentage points.
AI-assisted implementation; authorship/provenance are documented in README.md.
"""
from __future__ import annotations
import csv, hashlib, json, platform
from pathlib import Path
from typing import Any
import numpy as np
import scipy
from scipy import stats
from scipy.optimize import minimize

ROOT = Path(__file__).resolve().parent
CENTRE = np.array([8.0, 3.0, 30.0])
SCALE = np.array([1.0, 1.0, 15.0])
TERMS = ['Intercept','A','B','C','AB','AC','BC','A2','B2','C2']
COLS = {'Linear': [0,1,2,3], 'Additive quadratic': [0,1,2,3,7,8,9],
        'Full quadratic': list(range(10))}

def load_data(path: Path | None = None):
    path = path or ROOT/'data'/'citrus_bbd.csv'
    with path.open(newline='',encoding='utf-8') as f:
        rows=list(csv.DictReader(f))
    run=np.array([int(r['run']) for r in rows])
    raw=np.array([[float(r[k]) for k in ['A_mL_g','B_percent','C_min']] for r in rows])
    y=np.array([float(r['yield_percent']) for r in rows])
    if len(rows)!=17 or not np.isfinite(raw).all() or not np.isfinite(y).all():
        raise ValueError('Expected 17 finite reported observations.')
    if not np.array_equal(run,np.arange(1,18)):
        raise ValueError('Source run identifiers must be 1 through 17.')
    return run,raw,(raw-CENTRE)/SCALE,y

def design(z: np.ndarray) -> np.ndarray:
    z=np.atleast_2d(z); a,b,c=z.T
    return np.column_stack([np.ones(len(z)),a,b,c,a*b,a*c,b*c,a*a,b*b,c*c])

def fit(x: np.ndarray,y: np.ndarray) -> dict[str,Any]:
    n,p=x.shape
    beta,_,rank,_=np.linalg.lstsq(x,y,rcond=None)
    if rank!=p:
        raise ValueError(f'Non-identifiable design: rank {rank}, {p} coefficients.')
    pred=x@beta; resid=y-pred
    # QR geometry avoids squaring the condition number for the hat diagonal.
    q,_=np.linalg.qr(x,mode='reduced'); h=np.sum(q*q,axis=1)
    sse=float(resid@resid); sst=float(np.sum((y-y.mean())**2)); df=n-p
    if df<=0 or np.any(h>=1-1e-10):
        raise ValueError('Residual or leave-one-out variance is not identifiable.')
    mse=sse/df; loo_resid=resid/(1-h); press=float(loo_resid@loo_resid)
    cov=mse*np.linalg.solve(x.T@x,np.eye(p))
    return dict(beta=beta,pred=pred,resid=resid,hat=h,sse=sse,sst=sst,df=df,mse=mse,
                residual_sd=float(np.sqrt(mse)),r2=1-sse/sst,adj_r2=1-(sse/df)/(sst/(n-1)),
                train_rmse=float(np.sqrt(sse/n)),loo_resid=loo_resid,press=press,
                loo_rmse=float(np.sqrt(press/n)),pred_r2=1-press/sst,cov=cov,
                condition_number=float(np.linalg.cond(x)))

def expanded_beta(beta: np.ndarray,cols: list[int])->np.ndarray:
    b=np.zeros(10); b[cols]=beta; return b

def optimum(beta:np.ndarray) -> dict[str,Any]:
    hess=np.array([[2*beta[7],beta[4],beta[5]],
                   [beta[4],2*beta[8],beta[6]],
                   [beta[5],beta[6],2*beta[9]]])
    eig=np.linalg.eigvalsh(hess)
    try: z=np.linalg.solve(hess,-beta[1:4])
    except np.linalg.LinAlgError: z=np.full(3,np.nan)
    certified=bool(np.max(eig)<0 and np.isfinite(z).all() and np.max(np.abs(z))<=1)
    if not certified:
        # Bounded numerical fallback; report whether the analytical concavity check passed.
        sol=minimize(lambda t: -float((design(t)@beta)[0]),np.zeros(3),bounds=[(-1,1)]*3,
                     method='L-BFGS-B', options={'ftol':1e-14,'gtol':1e-12})
        if not sol.success: raise RuntimeError(sol.message)
        z=sol.x
    return dict(coded=z,physical=CENTRE+SCALE*z,yield_percent=float((design(z)@beta)[0]),
                hessian_eigenvalues=eig,certified_interior_maximum=certified)

def jsonable(v):
    if isinstance(v,np.ndarray): return v.tolist()
    if isinstance(v,(np.floating,np.integer,np.bool_)): return v.item()
    if isinstance(v,dict): return {k:jsonable(w) for k,w in v.items()}
    if isinstance(v,(list,tuple)): return [jsonable(w) for w in v]
    return v

def write_csv(path,rows):
    with path.open('w',newline='',encoding='utf-8') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)

def analyse()->dict:
    run,raw,z,y=load_data(); x=design(z); models={k:fit(x[:,cols],y) for k,cols in COLS.items()}
    full=models['Full quadratic']; additive=models['Additive quadratic']
    beta=full['beta']; opt=optimum(beta)
    center_mask=np.all(z==0,axis=1); yc=y[center_mask]
    pure_ss=float(np.sum((yc-yc.mean())**2)); pure_df=len(yc)-1
    lack_ss=full['sse']-pure_ss; lack_df=full['df']-pure_df
    lack_f=(lack_ss/lack_df)/(pure_ss/pure_df)
    interaction_f=((additive['sse']-full['sse'])/3)/full['mse']
    pred_rows=[]
    for i in range(17):
        pred_rows.append(dict(run=int(run[i]),reported_yield=float(y[i]),fitted_yield=float(full['pred'][i]),
             residual=float(full['resid'][i]),leverage=float(full['hat'][i]),
             loo_prediction=float(y[i]-full['loo_resid'][i]),loo_residual=float(full['loo_resid'][i])))
    # Source-specific settings remain distinct. No reconciliation is silently performed.
    recipes=[('Refitted maximum',opt['physical']),
             ('Record 8 numerical candidate',np.array([8.06092,3.05474,35.8081])),
             ('English manuscript practical recipe',np.array([8.1,3.05,36.])),
             ('Chinese record practical recipe',np.array([8.,3.05,36.])),
             ('Design centre',np.array([8.,3.,30.]))]
    candidates=[]
    for label,r in recipes:
        v=design((r-CENTRE)/SCALE)[0]; p=float(v@beta)
        candidates.append(dict(setting=label,A=float(r[0]),B=float(r[1]),C=float(r[2]),
                               predicted_yield=p,predicted_loss_from_refit=opt['yield_percent']-p))
    practical=np.array([8.1,3.05,36.]); xp=design((practical-CENTRE)/SCALE)[0]
    # Leave one record out; preserve every observation in primary fit.
    deletion=[]
    for i in range(17):
        keep=np.arange(17)!=i
        for name in ['Full quadratic','Additive quadratic']:
            cols=COLS[name]; xx=x[keep][:,cols]
            if np.linalg.matrix_rank(xx)!=len(cols): raise ValueError('Deletion design lost rank.')
            bb=expanded_beta(np.linalg.lstsq(xx,y[keep],rcond=None)[0],cols)
            oo=optimum(bb); fp=float(xp@bb)
            deletion.append(dict(omitted_run=i+1,model=name,A=oo['physical'][0],B=oo['physical'][1],C=oo['physical'][2],
                optimum_prediction=oo['yield_percent'],practical_prediction=fp,
                practical_loss=oo['yield_percent']-fp,concavity_certified=oo['certified_interior_maximum']))
    # Holding out an entire factor setting: rank check takes precedence over prediction.
    grouped=[]
    for loc in np.unique(z,axis=0):
        keep=~np.all(z==loc,axis=1)
        for name,cols in COLS.items():
            xx=x[keep][:,cols]; rank=int(np.linalg.matrix_rank(xx)); p=len(cols)
            iscenter=bool(np.all(loc==0))
            rec=dict(model=name,A=float((loc*SCALE+CENTRE)[0]),B=float((loc*SCALE+CENTRE)[1]),
                 C=float((loc*SCALE+CENTRE)[2]),centre=iscenter,rank=rank,parameters=p,
                 estimable=rank==p)
            if rank==p:
                b=np.linalg.lstsq(xx,y[keep],rcond=None)[0]
                rec['prediction']=float((design(loc)[:,cols]@b)[0])
                rec['observed_mean']=float(y[~keep].mean())
            else:
                rec['prediction']=None;rec['observed_mean']=float(y[~keep].mean())
            grouped.append(rec)
    # Rounding sensitivity, not an error model: each reported yield perturbed within +/- .005 pp.
    # Fixed seed; this is a bounded numerical stress test, not confidence intervals.
    seed=20261031; draws=5000
    rng=np.random.default_rng(seed); perturb=rng.uniform(-.005,.005,size=(draws,17))
    bs=(y[None,:]+perturb)@np.linalg.pinv(x).T
    rounding=[]; all_rounding_certified=True
    for b in bs:
        oo=optimum(b); all_rounding_certified &= oo['certified_interior_maximum']; rounding.append([*oo['physical'],oo['yield_percent'],oo['yield_percent']-float(xp@b)])
    rounding=np.asarray(rounding)
    # Nested model comparison is exploratory, not independent confirmatory model selection.
    result=dict(metadata=dict(data_sha256=hashlib.sha256((ROOT/'data'/'citrus_bbd.csv').read_bytes()).hexdigest(),
             python=platform.python_version(),numpy=np.__version__,scipy=scipy.__version__,
             reported_data=True,raw_lab_records_audited=False,rounding_seed=seed,rounding_draws=draws),
      models={k:{a:v for a,v in m.items() if a not in ['pred','resid','hat','loo_resid','cov']} for k,m in models.items()},
      pure_error=dict(ss=pure_ss,df=pure_df,sd=float(np.sqrt(pure_ss/pure_df)),centre_mean=float(yc.mean())),
      lack_of_fit=dict(ss=lack_ss,df=lack_df,F=float(lack_f),p=float(stats.f.sf(lack_f,lack_df,pure_df))),
      interactions=dict(F=float(interaction_f),df_num=3,df_denom=full['df'],p=float(stats.f.sf(interaction_f,3,full['df']))),
      full_optimum=opt,additive_optimum=optimum(expanded_beta(additive['beta'],COLS['Additive quadratic'])),
      candidates=candidates,
      deletion_summary={name:dict(minimum=np.min([[r[k] for k in ['A','B','C','practical_loss']] for r in deletion if r['model']==name],axis=0),
         maximum=np.max([[r[k] for k in ['A','B','C','practical_loss']] for r in deletion if r['model']==name],axis=0)) for name in ['Full quadratic','Additive quadratic']},
      rounding=dict(columns=['A','B','C','optimum_yield','practical_loss'],minimum=rounding.min(axis=0),maximum=rounding.max(axis=0),
                    all_concave_interior=all_rounding_certified),
      all_grouped_folds_estimable={k:all(r['estimable'] for r in grouped if r['model']==k) for k in COLS})
    out=ROOT/'results';out.mkdir(exist_ok=True)
    (out/'analysis.json').write_text(json.dumps(jsonable(result),indent=2)+'\n',encoding='utf-8')
    write_csv(out/'diagnostics.csv',pred_rows);write_csv(out/'deletion.csv',deletion)
    write_csv(out/'candidates.csv',candidates);write_csv(out/'group_holdouts.csv',grouped)
    np.savez_compressed(out/'rounding_sensitivity.npz',values=rounding)
    coef=[]
    for i,term in enumerate(TERMS):
        se=np.sqrt(full['cov'][i,i]);tval=beta[i]/se
        coef.append(dict(term=term,coefficient=beta[i],SE=se,t=tval,p=2*stats.t.sf(abs(tval),full['df'])))
    write_csv(out/'coefficients.csv',coef)
    return jsonable(result)

if __name__=='__main__':
    r=analyse();print(json.dumps(r,indent=2))
