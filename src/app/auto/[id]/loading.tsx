import { Balken } from "@/components/skelett";
import { Card } from "@/components/ui";

export default function Laedt() {
  return (
    <div className="space-y-8">
      <Balken className="h-4 w-64" />
      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <Balken className="aspect-[16/9] w-full" />
          <Balken className="h-8 w-2/3" />
          <Card className="p-5">
            <Balken className="h-4 w-1/3" />
            <Balken className="mt-3 h-4 w-full" />
            <Balken className="mt-2 h-4 w-4/5" />
          </Card>
        </div>
        <Card className="h-64 p-5">
          <Balken className="h-4 w-1/2" />
          <Balken className="mt-4 h-16 w-full" />
          <Balken className="mt-3 h-10 w-full" />
        </Card>
      </div>
    </div>
  );
}
