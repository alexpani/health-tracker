import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import LabPanelsList from "@/components/LabPanelsList"
import LabUploadDropzone from "@/components/LabUploadDropzone"

export default function Lab() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Laboratorio</h1>
          <p className="text-sm text-muted-foreground">
            Referti di analisi sangue e urine. Carica un PDF → review → conferma.
          </p>
        </div>
        <div className="w-80">
          <LabUploadDropzone />
        </div>
      </div>

      <Tabs defaultValue="referti">
        <TabsList>
          <TabsTrigger value="referti">Referti</TabsTrigger>
          <TabsTrigger value="matrice" disabled>
            Matrice
          </TabsTrigger>
          <TabsTrigger value="andamenti" disabled>
            Andamenti
          </TabsTrigger>
        </TabsList>

        <TabsContent value="referti" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Referti caricati</CardTitle>
            </CardHeader>
            <CardContent>
              <LabPanelsList />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
