import SwiftUI
import HealthKit

struct DashboardView: View {
    @State private var steps: Double = 0
    @State private var heartRate: Double = 0
    @State private var activeCalories: Double = 0
    @State private var sleepHours: Double = 0
    @State private var isLoading = true

    private let healthStore = HKHealthStore()

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: [
                    GridItem(.flexible()),
                    GridItem(.flexible())
                ], spacing: 16) {
                    MetricCard(
                        title: "Steps",
                        value: String(format: "%.0f", steps),
                        icon: "figure.walk",
                        color: .green
                    )
                    MetricCard(
                        title: "Heart Rate",
                        value: heartRate > 0 ? String(format: "%.0f bpm", heartRate) : "--",
                        icon: "heart.fill",
                        color: .red
                    )
                    MetricCard(
                        title: "Active Cal",
                        value: String(format: "%.0f kcal", activeCalories),
                        icon: "flame.fill",
                        color: .orange
                    )
                    MetricCard(
                        title: "Sleep",
                        value: sleepHours > 0 ? String(format: "%.1f hrs", sleepHours) : "--",
                        icon: "moon.fill",
                        color: .purple
                    )
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .task {
                await loadTodayData()
            }
            .refreshable {
                await loadTodayData()
            }
        }
    }

    private func loadTodayData() async {
        isLoading = true
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())

        async let stepsResult = fetchTodayStat(
            type: .quantityType(forIdentifier: .stepCount)!,
            unit: .count(),
            start: startOfDay
        )
        async let caloriesResult = fetchTodayStat(
            type: .quantityType(forIdentifier: .activeEnergyBurned)!,
            unit: .kilocalorie(),
            start: startOfDay
        )
        async let heartRateResult = fetchLatestSample(
            type: .quantityType(forIdentifier: .heartRate)!,
            unit: HKUnit.count().unitDivided(by: .minute())
        )
        async let sleepResult = fetchSleepHours(start: startOfDay)

        steps = await stepsResult
        activeCalories = await caloriesResult
        heartRate = await heartRateResult
        sleepHours = await sleepResult
        isLoading = false
    }

    private func fetchTodayStat(type: HKQuantityType, unit: HKUnit, start: Date) async -> Double {
        await withCheckedContinuation { continuation in
            let predicate = HKQuery.predicateForSamples(withStart: start, end: Date())
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, result, _ in
                let value = result?.sumQuantity()?.doubleValue(for: unit) ?? 0
                continuation.resume(returning: value)
            }
            healthStore.execute(query)
        }
    }

    private func fetchLatestSample(type: HKQuantityType, unit: HKUnit) async -> Double {
        await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: nil,
                limit: 1,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
            ) { _, results, _ in
                let value = (results?.first as? HKQuantitySample)?.quantity.doubleValue(for: unit) ?? 0
                continuation.resume(returning: value)
            }
            healthStore.execute(query)
        }
    }

    private func fetchSleepHours(start: Date) async -> Double {
        await withCheckedContinuation { continuation in
            guard let sleepType = HKCategoryType.categoryType(forIdentifier: .sleepAnalysis) else {
                continuation.resume(returning: 0)
                return
            }
            let predicate = HKQuery.predicateForSamples(
                withStart: Calendar.current.date(byAdding: .day, value: -1, to: start),
                end: Date()
            )
            let query = HKSampleQuery(
                sampleType: sleepType,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, results, _ in
                let totalSeconds = (results as? [HKCategorySample])?.reduce(0.0) { sum, sample in
                    // Only count asleep stages (not inBed)
                    if sample.value != HKCategoryValueSleepAnalysis.inBed.rawValue {
                        return sum + sample.endDate.timeIntervalSince(sample.startDate)
                    }
                    return sum
                } ?? 0
                continuation.resume(returning: totalSeconds / 3600)
            }
            healthStore.execute(query)
        }
    }
}

struct MetricCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(color)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text(value)
                .font(.title2)
                .fontWeight(.semibold)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
