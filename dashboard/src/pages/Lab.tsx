import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import LabCorrelations, { LabAiActivityBadge } from "@/components/LabCorrelations"
import LabMatrix from "@/components/LabMatrix"
import LabPanelsList from "@/components/LabPanelsList"
import LabTrends from "@/components/LabTrends"
import LabUploadDropzone from "@/components/LabUploadDropzone"

export default function Lab() {
  const [tab, setTab] = useState("referti")
  const [trendsSlug, setTrendsSlug] = useState<string | null>(null)

  function jumpToTrends(slug: string) {
    setTrendsSlug(slug)
    setTab("andamenti")
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">Laboratorio</h1>
            <LabAiActivityBadge />
          </div>
          <p className="text-sm text-muted-foreground">
            Referti di analisi sangue e urine. Carica un PDF → review → conferma.
          </p>
        </div>
        <div className="w-80">
          <LabUploadDropzone />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="referti">Referti</TabsTrigger>
          <TabsTrigger value="matrice">Matrice</TabsTrigger>
          <TabsTrigger value="andamenti">Andamenti</TabsTrigger>
          <TabsTrigger value="correlazioni">Correlazioni</TabsTrigger>
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

        <TabsContent value="matrice" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Matrice analiti × date</CardTitle>
              <p className="text-xs text-muted-foreground">
                Solo referti confermati. Click sul nome dell'analita → Andamenti.
                Celle in rosso: fuori range; in ambra: da rivedere.
              </p>
            </CardHeader>
            <CardContent>
              <LabMatrix onJumpToTrends={jumpToTrends} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="andamenti" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Andamenti nel tempo</CardTitle>
            </CardHeader>
            <CardContent>
              <LabTrends initialSlug={trendsSlug} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="correlazioni" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Possibili associazioni esame ↔ terapia/nota</CardTitle>
              <p className="text-xs text-muted-foreground">
                Variazioni marcate di un analita fra due prelievi in concomitanza
                con un evento di regime o nota di salute, ordinate per rilevanza.
              </p>
            </CardHeader>
            <CardContent>
              <LabCorrelations />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
