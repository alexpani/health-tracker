import SwiftUI
import HealthKit

struct DashboardView: View {
    @State private var steps: Double = 0
    @State private var activeCalories: Double = 0
    @State private var weight: Double = 0
    @State private var weightDate: Date?
    @State private var bodyFat: Double = 0
    @State private var bodyFatDate: Date?
    @State private var bmi: Double = 0
    @State private var bmiDate: Date?
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
                        title: "Peso",
                        value: weight > 0 ? String(format: "%.1f", weight) : "--",
                        unit: "kg",
                        icon: "scalemass.fill",
                        color: .purple,
                        subtitle: weightDate.map { formatRelative($0) }
                    )
                    MetricCard(
                        title: "Passi oggi",
                        value: String(format: "%.0f", steps),
                        icon: "figure.walk",
                        color: .green
                    )
                    MetricCard(
                        title: "Calorie attive",
                        value: String(format: "%.0f", activeCalories),
                        unit: "kcal",
                        icon: "flame.fill",
                        color: .orange
                    )
                    MetricCard(
                        title: "Massa grassa",
                        value: bodyFat > 0 ? String(format: "%.1f", bodyFat * 100) : "--",
                        unit: "%",
                        icon: "drop.fill",
                        color: .pink,
                        subtitle: bodyFatDate.map { formatRelative($0) }
                    )
                    MetricCard(
                        title: "BMI",
                        value: bmi > 0 ? String(format: "%.1f", bmi) : "--",
                        icon: "chart.bar.fill",
                        color: .blue,
                        subtitle: bmiDate.map { formatRelative($0) }
                    )
                }
                .padding()
            }
            .navigationTitle("Dashboard")
            .task {
                await loadData()
            }
            .refreshable {
                await loadData()
            }
        }
    }

    private func loadData() async {
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
        async let weightResult = fetchLatestSample(
            type: .quantityType(forIdentifier: .bodyMass)!,
            unit: .gramUnit(with: .kilo)
        )
        async let bodyFatResult = fetchLatestSample(
            type: .quantityType(forIdentifier: .bodyFatPercentage)!,
            unit: .percent()
        )
        async let bmiResult = fetchLatestSample(
            type: .quantityType(forIdentifier: .bodyMassIndex)!,
            unit: .count()
        )

        steps = await stepsResult
        activeCalories = await caloriesResult

        let (w, wDate) = await weightResult
        weight = w
        weightDate = wDate

        let (bf, bfDate) = await bodyFatResult
        bodyFat = bf
        bodyFatDate = bfDate

        let (b, bDate) = await bmiResult
        bmi = b
        bmiDate = bDate

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

    private func fetchLatestSample(type: HKQuantityType, unit: HKUnit) async -> (Double, Date?) {
        await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: nil,
                limit: 1,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: false)]
            ) { _, results, _ in
                if let sample = results?.first as? HKQuantitySample {
                    continuation.resume(returning: (sample.quantity.doubleValue(for: unit), sample.startDate))
                } else {
                    continuation.resume(returning: (0, nil))
                }
            }
            healthStore.execute(query)
        }
    }

    private func formatRelative(_ date: Date) -> String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        formatter.locale = Locale(identifier: "it_IT")
        return formatter.localizedString(for: date, relativeTo: Date())
    }
}

struct MetricCard: View {
    let title: String
    let value: String
    var unit: String? = nil
    let icon: String
    let color: Color
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundStyle(color)
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                Text(value)
                    .font(.title2)
                    .fontWeight(.semibold)
                if let unit {
                    Text(unit)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let subtitle {
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.regularMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
