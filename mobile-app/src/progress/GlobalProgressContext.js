import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const GlobalProgressContext = createContext(null);
const staged=[10,24,38,52,66,79,90];
export function GlobalProgressProvider({ children }) {
  const [jobs, setJobs] = useState([]);
  const runWithProgress = useCallback(async (label, fn) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
    setJobs((prev)=>[{id,label,state:'starting',percent:2,message:'Starting...'},...prev]);
    let i=0;
    const tick = setInterval(()=>{ setJobs((prev)=>prev.map((j)=>j.id===id && j.state!=='success' && j.state!=='error' ? { ...j, state:'processing', percent: staged[Math.min(i, staged.length-1)], message:'Processing...' } : j)); i++; if (i>=staged.length) clearInterval(tick); }, 450);
    const progress={ update:(percent, message)=>setJobs((prev)=>prev.map((j)=>j.id===id ? { ...j, state:'processing', percent, message: message || 'Processing...' } : j))};
    try {
      const result = await fn(progress);
      clearInterval(tick);
      setJobs((prev)=>prev.map((j)=>j.id===id ? { ...j, state:'success', percent:100, message:'Completed' } : j));
      setTimeout(()=>setJobs((prev)=>prev.filter((j)=>j.id!==id)), 2200);
      return result;
    } catch (error) {
      clearInterval(tick);
      setJobs((prev)=>prev.map((j)=>j.id===id ? { ...j, state:'error', percent:100, message: String(error.message || 'Failed') } : j));
      setTimeout(()=>setJobs((prev)=>prev.filter((j)=>j.id!==id)), 5000);
      throw error;
    }
  }, []);
  const value = useMemo(()=>({jobs, runWithProgress}), [jobs, runWithProgress]);
  return <GlobalProgressContext.Provider value={value}>{children}</GlobalProgressContext.Provider>;
}
export function useGlobalProgress(){
  const ctx = useContext(GlobalProgressContext);
  if (!ctx) throw new Error('useGlobalProgress must be used within GlobalProgressProvider');
  return ctx;
}
