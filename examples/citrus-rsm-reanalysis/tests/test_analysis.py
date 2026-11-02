"""Numerical consistency tests; not an audit of laboratory provenance."""
import sys, unittest
from pathlib import Path
import numpy as np
from scipy import stats
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from analyse import load_data,design,fit,optimum,COLS,CENTRE,SCALE

class AnalysisTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.run_ids,cls.raw,cls.z,cls.y=load_data();cls.x=design(cls.z);cls.m=fit(cls.x,cls.y)
    def test_source_structure(self):
        self.assertEqual(self.x.shape,(17,10));self.assertEqual(len(np.unique(self.z,axis=0)),13)
        self.assertEqual(np.sum(np.all(self.z==0,axis=1)),5)
    def test_exact_coefficient_reconstruction(self):
        expected=np.array([1.824,.0325,-.02875,.14875,.0025,.0025,.01,-.207,-.1895,-.1795])
        np.testing.assert_allclose(self.m['beta'],expected,atol=1e-12,rtol=0)
    def test_reported_statistics(self):
        self.assertEqual(round(self.m['r2'],4),.9891)
        self.assertEqual(round(self.m['adj_r2'],4),.9752)
        self.assertEqual(round(self.m['pred_r2'],4),.8566)
        self.assertAlmostEqual(self.m['sse'],.007845,places=12)
    def test_leave_one_out_direct_refits(self):
        err=[]
        for i in range(17):
            keep=np.arange(17)!=i
            b=np.linalg.lstsq(self.x[keep],self.y[keep],rcond=None)[0]
            err.append(self.y[i]-self.x[i]@b)
        np.testing.assert_allclose(err,self.m['loo_resid'],atol=2e-12,rtol=0)
    def test_qr_leverage(self):
        np.testing.assert_allclose(self.m['hat'][:12],.75,atol=1e-12)
        np.testing.assert_allclose(self.m['hat'][12:],.2,atol=1e-12)
        self.assertAlmostEqual(float(self.m['hat'].sum()),10,places=12)
    def test_lack_of_fit(self):
        yc=self.y[12:];pe=np.sum((yc-yc.mean())**2)
        lof=self.m['sse']-pe;F=(lof/3)/(pe/4)
        self.assertAlmostEqual(pe,.00152,places=12)
        self.assertEqual(round(float(stats.f.sf(F,3,4)),4),.0657)
    def test_optimum(self):
        o=optimum(self.m['beta'])
        self.assertTrue(o['certified_interior_maximum'])
        np.testing.assert_allclose(o['physical'],[8.080608009686173,2.935574252093876,36.19668227904543],atol=1e-10)
        self.assertAlmostEqual(o['yield_percent'],1.8569612165838179,places=12)
    def test_source_recipe_not_silently_changed(self):
        recipes=np.array([[8.1,3.05,36],[8.0,3.05,36]])
        p=design((recipes-CENTRE)/SCALE)@self.m['beta']
        np.testing.assert_allclose(p,[1.85436125,1.85306875],atol=1e-12)
    def test_grouped_holdout_nonidentifiability(self):
        self.assertEqual(np.linalg.matrix_rank(self.x[:12]),9)
        null=np.array([-2,0,0,0,0,0,0,1,1,1])
        np.testing.assert_equal(self.x[:12]@null,np.zeros(12))
        self.assertEqual(float(self.x[12]@null),-2)
        with self.assertRaises(ValueError): fit(self.x[:12],self.y[:12])
    def test_additive_comparison(self):
        a=fit(self.x[:,COLS['Additive quadratic']],self.y)
        self.assertAlmostEqual(a['loo_rmse'],.041639206637636164,places=12)
        self.assertLess(a['loo_rmse'],self.m['loo_rmse'])
    def test_external_implementation(self):
        # Cross-check a separately implemented library. Not independent human review.
        try: import statsmodels.api as sm
        except ImportError: self.skipTest('Optional statsmodels is not installed.')
        s=sm.OLS(self.y,self.x).fit()
        np.testing.assert_allclose(s.params,self.m['beta'],atol=1e-12)
        np.testing.assert_allclose(s.get_influence().hat_matrix_diag,self.m['hat'],atol=1e-12)

if __name__=='__main__': unittest.main(verbosity=2)
