#include <windows.h>

#include <cstdint>
#include <cstdlib>
#include <iostream>

int wmain(int argc, wchar_t** argv) {
    if (argc < 2 || argc > 3) return 2;
    const auto module = LoadLibraryExW(argv[1], nullptr, LOAD_LIBRARY_AS_DATAFILE);
    if (!module) return 3;
    const auto resource = FindResourceW(module, MAKEINTRESOURCEW(argc == 3 ? _wtoi(argv[2]) : 101), MAKEINTRESOURCEW(14));
    if (!resource) {
        FreeLibrary(module);
        return 4;
    }
    const auto handle = LoadResource(module, resource);
    const auto bytes = static_cast<const unsigned char*>(LockResource(handle));
    if (!bytes || SizeofResource(module, resource) < 6) return 5;
    const auto count = bytes[4] | (bytes[5] << 8);
    std::uint64_t hash = 14695981039346656037ULL;
    for (int index = 0; index < count; ++index) {
        const auto offset = 6 + index * 14;
        if (SizeofResource(module, resource) < offset + 14) return 7;
        const auto id = bytes[offset + 12] | (bytes[offset + 13] << 8);
        const auto icon = FindResourceW(module, MAKEINTRESOURCEW(id), MAKEINTRESOURCEW(3));
        if (!icon) return 8;
        const auto data = static_cast<const unsigned char*>(LockResource(LoadResource(module, icon)));
        if (!data) return 9;
        for (DWORD byte = 0; byte < SizeofResource(module, icon); ++byte) hash = (hash ^ data[byte]) * 1099511628211ULL;
    }
    std::cout << count << ' ' << hash;
    FreeLibrary(module);
    return count > 0 ? 0 : 6;
}
