import { Balken, KopfSkelett } from "@/components/skelett";
import { Card } from "@/components/ui";

export default function Laedt() {
  return (
    <div>
      <KopfSkelett />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card className="h-96 p-5">
          <Balken className="h-4 w-1/2" />
          <Balken className="mt-4 h-10 w-full" />
          <Balken className="mt-3 h-10 w-full" />
          <Balken className="mt-3 h-10 w-full" />
        </Card>
        <Card className="h-96 p-5">
          <Balken className="h-10 w-1/2" />
          <Balken className="mt-6 h-48 w-full" />
        </Card>
      </div>
    </div>
  );
}
