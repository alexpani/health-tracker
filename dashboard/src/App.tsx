import { Navigate, Route, Routes } from "react-router-dom"
import Layout from "@/components/layout/Layout"
import Activity from "@/pages/Activity"
import Vitals from "@/pages/Vitals"
import Body from "@/pages/Body"
import Sleep from "@/pages/Sleep"
import Workouts from "@/pages/Workouts"
import WorkoutCompare from "@/pages/WorkoutCompare"
import WorkoutDetail from "@/pages/WorkoutDetail"
import Records from "@/pages/Records"
import Nutrition from "@/pages/Nutrition"
import Stretching from "@/pages/Stretching"
import Explore from "@/pages/Explore"
import Fitness from "@/pages/Fitness"
import Insert from "@/pages/Insert"
import Lab from "@/pages/Lab"
import LabReview from "@/pages/LabReview"
// Clinical feature nascosta (vedi commenti su /clinical route + Sidebar.tsx)
// import Clinical from "@/pages/Clinical"
import Day from "@/pages/Day"
import Regimens from "@/pages/Regimens"
import HealthNotes from "@/pages/HealthNotes"
import Journal from "@/pages/Journal"
import Settings from "@/pages/Settings"

function TodayRedirect() {
  const today = new Date()
  const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  return <Navigate to={`/day/${ymd}`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<TodayRedirect />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/vitals" element={<Vitals />} />
        <Route path="/body" element={<Body />} />
        <Route path="/sleep" element={<Sleep />} />
        <Route path="/workouts" element={<Workouts />} />
        <Route path="/workouts/compare" element={<WorkoutCompare />} />
        <Route path="/workouts/:uuid" element={<WorkoutDetail />} />
        <Route path="/records" element={<Records />} />
        <Route path="/fitness" element={<Fitness />} />
        <Route path="/nutrition" element={<Nutrition />} />
        <Route path="/stretching" element={<Stretching />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/insert" element={<Insert />} />
        <Route path="/lab" element={<Lab />} />
        <Route path="/lab/panels/:id/review" element={<LabReview />} />
        {/* /clinical: nascosta (vedi Sidebar.tsx) finche' iPhone non autorizza HK Clinical. */}
        <Route path="/day" element={<Day />} />
        <Route path="/day/:date" element={<Day />} />
        <Route path="/regimens" element={<Regimens />} />
        <Route path="/health-notes" element={<HealthNotes />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  )
}
