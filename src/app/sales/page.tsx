import SalesClient from './SalesClient';

export default function SalesPage() {
  return (
    <div className="relative">
      <div className="absolute right-2 -top-12">
        {/* The actual button is rendered inside SalesClient to keep logic together; this placeholder keeps spacing */}
      </div>
      <SalesClient initial={[]} />
    </div>
  );
}


