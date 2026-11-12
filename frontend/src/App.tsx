import { useEffect } from 'react';
import { Annotator } from './components/Annotator';
import { Library } from './components/Library';
import { useStore } from './store';

export default function App() {
  const ready = useStore((s) => s.ready);
  const activeId = useStore((s) => s.activeId);

  useEffect(() => {
    void useStore.getState().init();
  }, []);

  if (!ready) return <div className="boot">Chargement…</div>;
  return activeId ? <Annotator /> : <Library />;
}
