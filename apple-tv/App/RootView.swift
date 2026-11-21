import PortalCore
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Group {
            switch model.route {
            case .loading:
                ProgressView("Finding your Portal Servers…")
            case .servers:
                ServerSetupView()
            case .pairing:
                PairingView()
            case .profiles:
                ProfilePickerView()
            case .catalog:
                CatalogView()
            case .player:
                NativePlayerView()
            case .playbackConflict:
                PlaybackConflictView()
            case let .failure(message):
                FailureView(message: message)
            }
        }
        .preferredColorScheme(.dark)
    }
}

private struct PlaybackConflictView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 28) {
            Image(systemName: "rectangle.2.swap").font(.system(size: 84)).foregroundStyle(.yellow)
            Text("Already playing").font(.largeTitle.bold())
            Text("This game is active on \(model.conflictDeviceName). Taking over ends that device’s lease and resumes from the newest acknowledged checkpoint.")
                .font(.title3).multilineTextAlignment(.center).frame(maxWidth: 850)
            HStack(spacing: 24) {
                Button("Cancel") { model.cancelTakeover() }
                Button("Take Over") { Task { await model.takeOverPlayback() } }
                    .buttonStyle(.borderedProminent)
            }
        }
    }
}

private struct ServerSetupView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 36) {
                Text("Home Game Portal")
                    .font(.system(size: 64, weight: .black, design: .rounded))
                Text("Choose a server on this network")
                    .font(.title2)
                    .foregroundStyle(.secondary)

                if !model.discovery.portals.isEmpty {
                    Text("Nearby").font(.title.bold())
                    HStack(spacing: 24) {
                        ForEach(model.discovery.portals) { portal in
                            Button {
                                Task { await model.addDiscoveredServer(portal) }
                            } label: {
                                Label(portal.name, systemImage: "server.rack")
                                    .frame(width: 340, height: 110)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                }

                if !model.servers.isEmpty {
                    Text("Saved Servers").font(.title.bold())
                    HStack(spacing: 24) {
                        ForEach(model.servers) { server in
                            Button {
                                Task { await model.connect(to: server) }
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(server.name).font(.headline)
                                    Text(server.endpoint.host ?? server.endpoint.absoluteString)
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                .frame(width: 340, height: 110, alignment: .leading)
                            }
                        }
                    }
                }

                Text("Manual address").font(.title.bold())
                HStack(spacing: 20) {
                    TextField("192.168.1.20:8090", text: $model.manualEndpoint)
                        .textContentType(.URL)
                        .frame(maxWidth: 700)
                    Button("Connect") { Task { await model.addManualServer() } }
                        .buttonStyle(.borderedProminent)
                }
                Text("LAN addresses only. You can save and switch between multiple servers.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(80)
        }
    }
}

private struct PairingView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 32) {
            Image(systemName: "link.badge.plus").font(.system(size: 92))
            Text("Pair this Apple TV").font(.largeTitle.bold())
            Text(model.pairingCode)
                .font(.system(size: 84, weight: .black, design: .monospaced))
                .accessibilityLabel("Pairing code \(model.pairingCode)")
            Text(model.pairingMessage)
                .font(.title3).multilineTextAlignment(.center).frame(maxWidth: 760)
            Button("Cancel") { model.showServers() }
        }
    }
}

private struct ProfilePickerView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(spacing: 54) {
            Text("Who’s Playing?")
                .font(.system(size: 64, weight: .black, design: .rounded))
            HStack(spacing: 34) {
                ForEach(model.profiles) { profile in
                    Button {
                        Task { await model.selectProfile(profile) }
                    } label: {
                        VStack(spacing: 18) {
                            Circle()
                                .fill(Color(hex: profile.avatarColor))
                                .frame(width: 150, height: 150)
                                .overlay(Image(systemName: "person.fill").font(.system(size: 70)))
                            Text(profile.displayName).font(.title3.bold())
                        }
                        .frame(width: 230, height: 260)
                    }
                    .buttonStyle(.card)
                }
            }
            Button("Switch Server") { model.showServers() }
        }
    }
}

private struct CatalogView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                header
                Group {
                    switch model.destination {
                    case .browse: BrowseView()
                    case .collections: CollectionsView()
                    case .library: LibraryView()
                    case .search: SearchView()
                    case .settings: SettingsView()
                    }
                }
            }
            .navigationDestination(for: GameSummary.self) { GameDetailView(game: $0) }
            .navigationDestination(for: CatalogPresentation.Collection.self) { CollectionDetailView(collection: $0) }
        }
        .tint(Color(hex: model.selectedProfile?.accentColor ?? "#e50914"))
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading) {
                Text("Home Game Portal").font(.title.bold())
                Text(model.selectedProfile?.displayName ?? "Player").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            ForEach(AppModel.Destination.allCases) { destination in
                Button(destination.rawValue) { model.destination = destination }
                    .buttonStyle(.bordered)
                    .accessibilityAddTraits(model.destination == destination ? .isSelected : [])
            }
            if !model.controllers.hasRequiredController {
                Image(systemName: "gamecontroller").foregroundStyle(.yellow)
                    .accessibilityLabel("Connect a controller to play")
            } else {
                Image(systemName: "gamecontroller.fill").foregroundStyle(.green)
                    .accessibilityLabel("Game controller connected")
            }
            Button {
                model.route = .profiles
            } label: {
                Image(systemName: "person.crop.circle")
                    .accessibilityLabel("Player Profiles")
            }
        }
        .padding(.horizontal, 54)
        .padding(.vertical, 24)
        .background(.black.opacity(0.42))
    }
}

private struct BrowseView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 44) {
                if let featured = model.games.first {
                    NavigationLink(value: featured) {
                        ZStack(alignment: .bottomLeading) {
                            AsyncImage(url: model.artworkURL(for: featured)) { image in
                                image.resizable().scaledToFill()
                            } placeholder: { Color.red.opacity(0.18) }
                            .frame(height: 360).clipped()
                            LinearGradient(colors: [.clear, .black.opacity(0.9)], startPoint: .center, endPoint: .bottom)
                            VStack(alignment: .leading, spacing: 8) {
                                Text("FEATURED").font(.caption.bold()).foregroundStyle(.red)
                                Text(featured.displayName).font(.system(size: 52, weight: .black, design: .rounded))
                                Text(featured.description).font(.headline).lineLimit(2).frame(maxWidth: 850, alignment: .leading)
                            }.padding(38)
                        }
                        .clipShape(RoundedRectangle(cornerRadius: 28))
                    }.buttonStyle(.card)
                }
                ForEach(model.presentation.browseRows.sorted { $0.position < $1.position }) { row in
                    GameShelf(title: row.title, games: row.games)
                }
                if model.presentation.browseRows.isEmpty {
                    GameShelf(title: "Nintendo Entertainment System", games: model.games)
                }
            }
            .padding(54)
        }
    }
}

private struct GameShelf: View {
    let title: String
    let games: [GameSummary]

    var body: some View {
        if !games.isEmpty {
            VStack(alignment: .leading, spacing: 18) {
                Text(title).font(.title.bold())
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 28) { ForEach(games) { game in GameCard(game: game) } }
                }
            }
        }
    }
}

private struct CollectionsView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 380), spacing: 30)], spacing: 30) {
                ForEach(model.presentation.collections) { collection in
                    NavigationLink(value: collection) {
                        VStack(alignment: .leading, spacing: 14) {
                            Image(systemName: "square.stack.3d.up.fill").font(.system(size: 54)).foregroundStyle(.red)
                            Text(collection.name).font(.title2.bold())
                            Text(collection.description).lineLimit(3).foregroundStyle(.secondary)
                            Text("\(collection.games.count) games").font(.caption.bold())
                        }
                        .frame(maxWidth: .infinity, minHeight: 210, alignment: .leading)
                        .padding(28).background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 24))
                    }.buttonStyle(.card)
                }
            }.padding(54)
        }
    }
}

private struct CollectionDetailView: View {
    let collection: CatalogPresentation.Collection

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                Text(collection.name).font(.largeTitle.bold())
                Text(collection.description).font(.title3).foregroundStyle(.secondary)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 30)], spacing: 34) {
                    ForEach(collection.games) { GameCard(game: $0) }
                }
            }.padding(60)
        }
    }
}

private struct LibraryView: View {
    @EnvironmentObject private var model: AppModel

    private var sortedGames: [GameSummary] {
        switch model.librarySort {
        case .title: model.games.sorted { $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending }
        case .releaseYear: model.games.sorted {
            $0.releaseYear == $1.releaseYear
                ? $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending
                : $0.releaseYear < $1.releaseYear
        }
        case .recentlyPlayed: model.games.sorted { ($0.lastPlayedAt ?? "") > ($1.lastPlayedAt ?? "") }
        case .recentlyAdded: model.games.sorted { $0.addedAt > $1.addedAt }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                HStack {
                    Text("My Library").font(.largeTitle.bold())
                    Spacer()
                    Picker("Sort", selection: $model.librarySort) {
                        ForEach(AppModel.LibrarySort.allCases) { Text($0.rawValue).tag($0) }
                    }.frame(width: 420)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 30)], spacing: 34) {
                    ForEach(sortedGames) { GameCard(game: $0) }
                }
            }.padding(54)
        }
    }
}

private struct SearchView: View {
    @EnvironmentObject private var model: AppModel

    private var results: [GameSummary] {
        let query = model.searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        return model.games.filter { game in
            ([game.displayName, game.platformName, game.series ?? ""] + game.genres + game.universes)
                .contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                TextField("Search games, genres, series, or collections", text: $model.searchText)
                    .textContentType(.name)
                Text(model.searchText.isEmpty ? "Enter a search" : "\(results.count) results")
                    .foregroundStyle(.yellow)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 30)], spacing: 34) {
                    ForEach(results) { GameCard(game: $0) }
                }
            }.padding(54)
        }
    }
}

private struct SettingsView: View {
    @EnvironmentObject private var model: AppModel
    @State private var editingServer: PortalServerDescriptor?
    @State private var forgettingServer: PortalServerDescriptor?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 38) {
                Text("Settings").font(.largeTitle.bold())
                if let message = model.statusMessage {
                    Label(message, systemImage: "info.circle").foregroundStyle(.secondary)
                }

                settingsSection("Servers") {
                    ForEach(model.servers) { server in
                        HStack(spacing: 24) {
                            Image(systemName: "server.rack").font(.title)
                            VStack(alignment: .leading) {
                                Text(server.name).font(.headline)
                                Text(server.endpoint.absoluteString).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("Switch") { Task { await model.connect(to: server) } }
                            Button("Test") { Task { await model.testConnection(server) } }
                            Button("Edit") { editingServer = server }
                            Button("Forget", role: .destructive) { forgettingServer = server }
                        }
                    }
                    HStack {
                        TextField("Add 192.168.1.20:8090", text: $model.manualEndpoint)
                        Button("Add Server") { Task { await model.addManualServer() } }
                    }
                }

                settingsSection("Controllers") {
                    if model.controllers.assignments.isEmpty {
                        Label("No physical controller connected", systemImage: "gamecontroller")
                            .foregroundStyle(.yellow)
                        Text("Pair an Xbox, PlayStation, Switch-compatible, or MFi controller in Apple TV Settings. The Siri Remote is used only for navigation.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(model.controllers.assignments) { assignment in
                            Label("Player \(assignment.player): \(assignment.name)", systemImage: "gamecontroller.fill")
                                .foregroundStyle(.green)
                        }
                    }
                }

                settingsSection("Appearance") {
                    Text("Theme: \(model.selectedProfile?.themeKey ?? "Default")")
                    HStack {
                        Text("Profile accent")
                        Circle().fill(Color(hex: model.selectedProfile?.accentColor ?? "#e50914"))
                            .frame(width: 34, height: 34)
                    }
                    Text("Appearance follows the selected Player Profile and remains managed by the web portal.")
                        .foregroundStyle(.secondary)
                }

                settingsSection("Playback") {
                    Label("Correct 4:3 presentation", systemImage: "rectangle.inset.filled")
                    Label("Nearest-neighbor native rendering", systemImage: "square.grid.3x3")
                    Label("Temporary verified ROM downloads", systemImage: "internaldrive")
                }

                settingsSection("Diagnostics") {
                    diagnostic("App", Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0")
                    diagnostic("Server", model.system?.serverVersion ?? "Unavailable")
                    diagnostic("API", model.system?.apiVersions.joined(separator: ", ") ?? "Unavailable")
                    diagnostic("Core", "FCEUmm · source pin pending")
                    diagnostic("Transport", model.system?.transport.scope ?? "LAN only")
                }

                settingsSection("Legal & Privacy") {
                    Text("Home Game Portal contains no analytics, advertising, or tracking. Game bytes travel only between the selected Portal Server and this Apple TV.")
                    Text("Only use Game Files you are legally entitled to use. FCEUmm is provided under GPL-2.0; corresponding source and notices are included with this project.")
                        .foregroundStyle(.secondary)
                }
            }.padding(54)
        }
        .sheet(item: $editingServer) { server in
            ServerEditorView(server: server)
        }
        .confirmationDialog(
            "Forget this server? Its Apple TV credential will be deleted. The server and other devices are unchanged.",
            isPresented: Binding(
                get: { forgettingServer != nil },
                set: { if !$0 { forgettingServer = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Forget Server", role: .destructive) {
                guard let server = forgettingServer else { return }
                forgettingServer = nil
                Task { await model.forgetServer(server) }
            }
            Button("Cancel", role: .cancel) { forgettingServer = nil }
        }
    }

    private func settingsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(title).font(.title.bold())
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(30)
        .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 24))
    }

    private func diagnostic(_ name: String, _ value: String) -> some View {
        HStack { Text(name).foregroundStyle(.secondary); Spacer(); Text(value).font(.body.monospaced()) }
    }
}

private struct ServerEditorView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss
    let server: PortalServerDescriptor
    @State private var name: String
    @State private var address: String

    init(server: PortalServerDescriptor) {
        self.server = server
        _name = State(initialValue: server.name)
        _address = State(initialValue: server.endpoint.absoluteString)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 30) {
            Text("Edit Server").font(.largeTitle.bold())
            TextField("Local name", text: $name)
            TextField("Address and port", text: $address).textContentType(.URL)
            HStack {
                Button("Cancel") { dismiss() }
                Button("Save") {
                    Task { if await model.updateServer(server, name: name, address: address) { dismiss() } }
                }.buttonStyle(.borderedProminent)
            }
        }.padding(80)
    }
}

private struct GameCard: View {
    @EnvironmentObject private var model: AppModel
    let game: GameSummary

    var body: some View {
        NavigationLink(value: game) {
            VStack(alignment: .leading, spacing: 12) {
                AsyncImage(url: model.artworkURL(for: game)) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    ZStack { Color.white.opacity(0.08); Image(systemName: "gamecontroller.fill").font(.system(size: 52)) }
                }
                .frame(width: 260, height: 360).clipped().clipShape(RoundedRectangle(cornerRadius: 18))
                Text(game.displayName).font(.headline).lineLimit(1)
                Text(game.releaseYear > 0 ? String(game.releaseYear) : game.platformName)
                    .font(.caption).foregroundStyle(.secondary)
            }
            .frame(width: 260, alignment: .leading)
        }
        .buttonStyle(.card)
        .accessibilityLabel("\(game.displayName), \(game.platformName)")
    }
}

private struct GameDetailView: View {
    @EnvironmentObject private var model: AppModel
    let game: GameSummary
    @State private var confirmStartNew = false
    @State private var confirmDismiss = false

    var body: some View {
        HStack(alignment: .top, spacing: 64) {
            AsyncImage(url: model.artworkURL(for: game)) { image in
                image.resizable().scaledToFill()
            } placeholder: { Color.white.opacity(0.08) }
            .frame(width: 420, height: 580).clipped().clipShape(RoundedRectangle(cornerRadius: 24))
            VStack(alignment: .leading, spacing: 26) {
                Text(game.displayName).font(.system(size: 58, weight: .black, design: .rounded))
                Text([game.platformName, game.releaseYear > 0 ? String(game.releaseYear) : nil].compactMap { $0 }.joined(separator: " • "))
                    .font(.title3).foregroundStyle(.secondary)
                Text(game.description).font(.title3).lineLimit(8)
                if !game.genres.isEmpty { Text(game.genres.joined(separator: " · ")).foregroundStyle(.secondary) }
                if let series = game.series { Text("Series: \(series)").foregroundStyle(.secondary) }
                HStack(spacing: 22) {
                    if game.hasServerSave {
                        Button("Resume") { Task { await model.launchGame(game, intent: "resume") } }
                            .buttonStyle(.borderedProminent)
                    }
                    Button(game.hasServerSave ? "Start New" : "Play") {
                        if game.hasServerSave { confirmStartNew = true }
                        else { Task { await model.launchGame(game, intent: "fresh") } }
                    }
                    Button(game.isFavorite ? "Remove Favorite" : "Add Favorite") {
                        Task { await model.toggleFavorite(game) }
                    }
                    if game.isContinuePlaying {
                        Button("Remove from Continue") { confirmDismiss = true }
                    }
                }
                if !model.controllers.hasRequiredController {
                    Label("A Bluetooth game controller is required", systemImage: "gamecontroller")
                        .foregroundStyle(.yellow)
                }
            }
        }
        .padding(70)
        .confirmationDialog("Start a new game? Your previous checkpoint lineage will remain available for recovery.", isPresented: $confirmStartNew, titleVisibility: .visible) {
            Button("Start New Game", role: .destructive) { Task { await model.launchGame(game, intent: "fresh") } }
            Button("Cancel", role: .cancel) {}
        }
        .confirmationDialog("Remove this game from Continue Playing? Saves, checkpoints, favorites, and history will be kept.", isPresented: $confirmDismiss, titleVisibility: .visible) {
            Button("Remove") { Task { await model.dismissContinuePlaying(game) } }
            Button("Cancel", role: .cancel) {}
        }
    }
}

private struct FailureView: View {
    @EnvironmentObject private var model: AppModel
    let message: String

    var body: some View {
        VStack(spacing: 28) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 80)).foregroundStyle(.yellow)
            Text("Something needs attention").font(.largeTitle.bold())
            Text(message).font(.title3).multilineTextAlignment(.center).frame(maxWidth: 850)
            Button("Back to Servers") { model.showServers() }
        }
    }
}

private extension Color {
    init(hex: String) {
        let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        let integer = UInt64(value, radix: 16) ?? 0x666666
        self.init(
            red: Double((integer >> 16) & 0xff) / 255,
            green: Double((integer >> 8) & 0xff) / 255,
            blue: Double(integer & 0xff) / 255
        )
    }
}
