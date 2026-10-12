#include <cstdlib>
#include <iostream>

int main() {
    if (std::getenv("ARRANGE_TEST_HELPER_FAIL")) return 7;
    std::cout << "{\"Name\":\"\u4e2d\u6587 & Product\"}";
    return 0;
}
