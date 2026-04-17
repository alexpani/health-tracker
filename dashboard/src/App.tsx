import { Route, Routes } from "react-router-dom"
import Layout from "@/components/layout/Layout"
import Home from "@/pages/Home"
import Activity from "@/pages/Activity"
import Vitals from "@/pages/Vitals"
import Body from "@/pages/Body"
import Sleep from "@/pages/Sleep"
import Workouts from "@/pages/Workouts"
import Nutrition from "@/pages/Nutrition"
import Explore from "@/pages/Explore"
import Insert from "@/pages/Insert"

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/vitals" element={<Vitals />} />
        <Route path="/body" element={<Body />} />
        <Route path="/sleep" element={<Sleep />} />
        <Route path="/workouts" element={<Workouts />} />
        <Route path="/nutrition" element={<Nutrition />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/insert" element={<Insert />} />
      </Route>
    </Routes>
  )
}
